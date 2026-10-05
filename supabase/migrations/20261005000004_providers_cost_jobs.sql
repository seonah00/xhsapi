-- M0 operations: provider permissions/capabilities/prices, budgets, quotes,
-- idempotency, usage ledger, jobs (outbox), deletion requests.
-- Money is numeric(20,8); never JS floats (spec 7).

create table public.provider_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  scope text not null check (scope in ('environment', 'cohort', 'internal')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked', 'expired')),
  allow_fetch boolean not null default false,
  allow_metadata_display boolean not null default false,
  allow_excerpt_display boolean not null default false,
  allow_media_display boolean not null default false,
  allow_ai_processing boolean not null default false,
  allow_cache boolean not null default false,
  allowed_categories text[] not null default '{}',
  allowed_endpoints text[] not null default '{}',
  max_audience integer,
  cache_ttl_seconds integer check (cache_ttl_seconds > 0),
  expires_at timestamptz,
  evidence_private_file_id uuid,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  -- Approval requires a named human and evidence (spec 6.2); never automatic.
  check (status <> 'approved' or (approved_by is not null and approved_at is not null and evidence_private_file_id is not null)),
  unique (org_id, id)
);

create table public.provider_capabilities (
  provider text not null,
  endpoint text not null,
  path text not null,
  params_status text not null check (params_status in ('documented', 'parameter_unverified', 'verified', 'not_implemented')),
  verification_status text not null check (verification_status in ('documented', 'sandbox_verified', 'live_verified', 'suspended', 'unavailable')),
  schema_version text not null default 'v1',
  price_status text not null default 'unknown' check (price_status in ('unknown', 'verified')),
  phase text not null check (phase in ('P0', 'P1', 'excluded')),
  data_limits_json jsonb not null default '{}'::jsonb,
  note text,
  primary key (provider, endpoint)
);

create table public.provider_price_versions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  endpoint text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit text not null,
  unit_cost numeric(20, 8) not null check (unit_cost >= 0),
  effective_at timestamptz not null,
  verified_by uuid not null references auth.users(id),
  evidence text not null,
  foreign key (provider, endpoint) references public.provider_capabilities(provider, endpoint)
);

create table public.usage_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('org', 'user')),
  subject_id uuid not null,
  period_start date not null,
  period_end date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_limit numeric(20, 8) not null default 0 check (amount_limit >= 0), -- live budget defaults to 0 (spec 9.2)
  call_limits_json jsonb not null default '{}'::jsonb,
  reserved_total numeric(20, 8) not null default 0 check (reserved_total >= 0),
  settled_total numeric(20, 8) not null default 0 check (settled_total >= 0),
  revision integer not null default 1,
  updated_by uuid,
  check (period_end > period_start),
  check (reserved_total + settled_total <= amount_limit),
  unique (org_id, subject_type, subject_id, period_start, period_end, currency)
);

create table public.cost_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  operation text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  data_mode text not null check (data_mode in ('mock', 'live')),
  scope_json jsonb not null default '{}'::jsonb,
  max_billable_units integer not null check (max_billable_units >= 0),
  max_amount numeric(20, 8) not null check (max_amount >= 0),
  currency text not null,
  price_version_ids uuid[] not null default '{}',
  permission_versions jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default now() + interval '5 minutes',
  consumed_at timestamptz,
  consumed_by_request_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  check (data_mode = 'mock' or array_length(price_version_ids, 1) > 0)
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  route text not null,
  key text not null check (length(key) between 8 and 128),
  request_hash text not null,
  state text not null check (state in ('in_progress', 'completed', 'failed')),
  resource_id uuid,
  redacted_response_snapshot jsonb,
  holds_paid_work boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  unique (org_id, owner_user_id, route, key)
);

create table public.app_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid,
  kind text not null check (kind in (
    'provider_search', 'rank_refresh', 'reference_analysis', 'query_expansion', 'plan_generation', 'contextual_check',
    'results_reflection', 'trend_aggregation', 'data_expiry', 'user_deletion',
    'transcript_submit', 'transcript_result', 'ocr', 'comment_submit', 'comment_result', 'csv_import')),
  data_mode text not null check (data_mode in ('mock', 'live')),
  input_ref jsonb not null default '{}'::jsonb, -- references only, never raw student text or keys
  state text not null default 'queued' check (state in ('queued', 'running', 'waiting_external', 'succeeded', 'partial', 'failed', 'cancelled', 'unknown_outcome')),
  dedupe_key text not null,
  provider_task_id text,
  visible_after timestamptz,
  attempts integer not null default 0,
  reserved_usage_id uuid,
  dispatched_at timestamptz, -- outbox: null = not yet handed to the queue
  worker_id text,
  lease_expires_at timestamptz,
  error_code text,
  result_ref jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index app_jobs_outbox on public.app_jobs (created_at) where dispatched_at is null and state = 'queued';
create index app_jobs_claimable on public.app_jobs (visible_after) where state in ('queued', 'waiting_external');
create trigger app_jobs_touch before update on public.app_jobs for each row execute function app.touch_updated_at();

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  request_id uuid not null,
  job_id uuid references public.app_jobs(id),
  quote_id uuid references public.cost_quotes(id),
  provider text not null,
  endpoint text not null,
  price_version uuid,
  currency text not null,
  reserved_amount numeric(20, 8) not null check (reserved_amount >= 0),
  actual_amount numeric(20, 8) check (actual_amount >= 0),
  -- demo rows (mock mode) are excluded from real spend statistics.
  status text not null check (status in ('demo', 'reserved', 'settled', 'released', 'unknown_outcome')),
  billable_units integer,
  occurred_at timestamptz not null default now()
);
create index usage_ledger_period on public.usage_ledger (org_id, occurred_at);

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  scope text not null check (scope in ('all_my_data', 'account', 'reference', 'plan', 'transcript')),
  target_id uuid,
  requested_at timestamptz not null default now(),
  state text not null default 'requested' check (state in ('requested', 'access_blocked', 'completed', 'partially_retained')),
  completed_at timestamptz,
  exception_reason text,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Atomic quote consumption + budget reservation + ledger + job + idempotency
-- (spec 7, 9.1, 9.2). Locks budgets in a fixed order (org row, then user row).
-- Same key + same request returns the existing job without consuming again.
-- ---------------------------------------------------------------------------
create or replace function app.reserve_and_enqueue(
  p_org uuid, p_quote uuid, p_route text, p_idem_key text, p_request_hash text,
  p_job_kind text, p_dedupe_key text, p_input_ref jsonb
) returns table (job_id uuid, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_idem public.idempotency_keys;
  v_quote public.cost_quotes;
  v_budget public.usage_budgets;
  v_job uuid;
  v_request uuid := gen_random_uuid();
  v_ledger uuid;
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_uid is null or not app.is_member(p_org) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;

  -- Serialize per idempotency key; a concurrent duplicate waits here, then replays.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || v_uid::text || p_route || p_idem_key, 0));
  select * into v_idem from public.idempotency_keys
    where org_id = p_org and owner_user_id = v_uid and route = p_route and key = p_idem_key;
  if found then
    if v_idem.request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_MISMATCH' using errcode = 'P0001'; end if;
    return query select v_idem.resource_id, true;
    return;
  end if;

  select * into v_quote from public.cost_quotes where id = p_quote for update;
  if not found or v_quote.org_id <> p_org or v_quote.owner_user_id <> v_uid then raise exception 'QUOTE_INVALID' using errcode = 'P0001'; end if;
  if v_quote.consumed_at is not null then raise exception 'QUOTE_CONSUMED' using errcode = 'P0001'; end if;
  if v_quote.expires_at <= now() then raise exception 'QUOTE_EXPIRED' using errcode = 'P0001'; end if;
  if v_quote.request_hash <> p_request_hash then raise exception 'QUOTE_REQUEST_MISMATCH' using errcode = 'P0001'; end if;

  if v_quote.data_mode = 'live' then
    for v_budget in
      select * from public.usage_budgets b
      where b.org_id = p_org and b.currency = v_quote.currency and b.period_start <= v_today and b.period_end > v_today
        and ((b.subject_type = 'org' and b.subject_id = p_org) or (b.subject_type = 'user' and b.subject_id = v_uid))
      order by case b.subject_type when 'org' then 0 else 1 end, b.id
      for update
    loop
      if v_budget.amount_limit - v_budget.settled_total - v_budget.reserved_total < v_quote.max_amount then
        raise exception 'BUDGET_EXCEEDED' using errcode = 'P0001';
      end if;
      update public.usage_budgets set reserved_total = reserved_total + v_quote.max_amount, revision = revision + 1 where id = v_budget.id;
    end loop;
    -- No org budget row means a zero budget: live is blocked by default.
    if not exists (select 1 from public.usage_budgets b where b.org_id = p_org and b.subject_type = 'org' and b.subject_id = p_org
                   and b.currency = v_quote.currency and b.period_start <= v_today and b.period_end > v_today) then
      raise exception 'BUDGET_EXCEEDED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.app_jobs (org_id, owner_user_id, kind, data_mode, input_ref, dedupe_key)
    values (p_org, v_uid, p_job_kind, v_quote.data_mode, coalesce(p_input_ref, '{}'::jsonb), p_dedupe_key)
    returning id into v_job;
  insert into public.usage_ledger (org_id, user_id, request_id, job_id, quote_id, provider, endpoint, currency, reserved_amount, status, price_version)
    values (p_org, v_uid, v_request, v_job, p_quote, coalesce(v_quote.scope_json ->> 'provider', 'unknown'),
            coalesce(v_quote.scope_json ->> 'endpoint', v_quote.operation), v_quote.currency,
            case when v_quote.data_mode = 'live' then v_quote.max_amount else 0 end,
            case when v_quote.data_mode = 'live' then 'reserved' else 'demo' end,
            v_quote.price_version_ids[1])
    returning id into v_ledger;
  update public.app_jobs set reserved_usage_id = v_ledger where id = v_job;
  update public.cost_quotes set consumed_at = now(), consumed_by_request_id = v_request where id = p_quote;
  insert into public.idempotency_keys (org_id, owner_user_id, route, key, request_hash, state, resource_id, holds_paid_work)
    values (p_org, v_uid, p_route, p_idem_key, p_request_hash, 'completed', v_job, v_quote.data_mode = 'live');

  return query select v_job, false;
end $$;

-- Settlement by the worker (service role). Unknown outcomes keep the reservation (spec 9.2).
create or replace function app.settle_usage(p_ledger uuid, p_outcome text, p_actual numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.usage_ledger;
  v_today date;
begin
  select * into v_row from public.usage_ledger where id = p_ledger for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status = 'demo' then return; end if;
  if v_row.status not in ('reserved', 'unknown_outcome') then raise exception 'ALREADY_SETTLED' using errcode = 'P0001'; end if;
  v_today := (v_row.occurred_at at time zone 'utc')::date;

  if p_outcome = 'unknown_outcome' then
    update public.usage_ledger set status = 'unknown_outcome' where id = p_ledger;
    return;
  end if;
  if p_outcome = 'settled' and (p_actual is null or p_actual < 0 or p_actual > v_row.reserved_amount) then
    raise exception 'VALIDATION_FAILED: actual must be within reservation' using errcode = 'P0001';
  end if;
  if p_outcome not in ('settled', 'released') then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;

  update public.usage_budgets b
     set reserved_total = b.reserved_total - v_row.reserved_amount,
         settled_total = b.settled_total + case when p_outcome = 'settled' then p_actual else 0 end,
         revision = b.revision + 1
   where b.org_id = v_row.org_id and b.currency = v_row.currency and b.period_start <= v_today and b.period_end > v_today
     and ((b.subject_type = 'org' and b.subject_id = v_row.org_id) or (b.subject_type = 'user' and b.subject_id = v_row.user_id));
  update public.usage_ledger set status = p_outcome, actual_amount = case when p_outcome = 'settled' then p_actual else 0 end
   where id = p_ledger;
end $$;

-- Worker claim: atomic, lease-based; duplicate deliveries cannot double-run (spec 9.1).
create or replace function app.claim_job(p_job uuid, p_worker text, p_lease interval default interval '5 minutes')
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update public.app_jobs
     set state = 'running', worker_id = p_worker, lease_expires_at = now() + p_lease, attempts = attempts + 1
   where id = p_job
     and (state in ('queued', 'waiting_external') or (state = 'running' and lease_expires_at < now()))
     and (visible_after is null or visible_after <= now())
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function app.reserve_and_enqueue(uuid, uuid, text, text, text, text, text, jsonb), app.settle_usage(uuid, text, numeric), app.claim_job(uuid, text, interval) from public;
grant execute on function app.reserve_and_enqueue(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;
grant execute on function app.settle_usage(uuid, text, numeric), app.claim_job(uuid, text, interval) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.provider_permissions enable row level security;
alter table public.provider_capabilities enable row level security;
alter table public.provider_price_versions enable row level security;
alter table public.usage_budgets enable row level security;
alter table public.cost_quotes enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.app_jobs enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.deletion_requests enable row level security;

create policy admin_all on public.provider_permissions for all to authenticated
  using (app.has_role(org_id, array['org_admin']))
  with check (app.has_role(org_id, array['org_admin']) and (status <> 'approved' or approved_by = auth.uid()));
create policy read_all on public.provider_capabilities for select to authenticated using (true);
create policy read_all on public.provider_price_versions for select to authenticated using (true);
create policy own_or_admin on public.usage_budgets for select to authenticated
  using (app.has_role(org_id, array['org_admin']) or (subject_type = 'user' and subject_id = auth.uid() and app.is_member(org_id)));
create policy own on public.cost_quotes for select to authenticated using (owner_user_id = auth.uid());
create policy own on public.idempotency_keys for select to authenticated using (owner_user_id = auth.uid());
create policy own on public.app_jobs for select to authenticated using (owner_user_id = auth.uid() and app.is_member(org_id));
create policy own_or_admin on public.usage_ledger for select to authenticated
  using (app.has_role(org_id, array['org_admin']) or (user_id = auth.uid() and app.is_member(org_id)));
create policy own on public.deletion_requests for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid() and app.is_member(org_id) and state = 'requested');

grant select, insert, update on public.provider_permissions to authenticated;
grant select on public.provider_capabilities, public.provider_price_versions, public.usage_budgets, public.cost_quotes,
  public.idempotency_keys, public.app_jobs, public.usage_ledger to authenticated;
grant select, insert on public.deletion_requests to authenticated;

-- Admin job view without input payloads (spec F12: minimal info).
create view public.admin_jobs with (security_barrier = true) as
  select j.id, j.org_id, j.kind, j.data_mode, j.state, j.attempts, j.error_code, j.created_at, j.updated_at
  from public.app_jobs j where app.has_role(j.org_id, array['org_admin']);
grant select on public.admin_jobs to authenticated;

-- Capability registry seed (mirrors packages/providers/src/capabilities.ts).
insert into public.provider_capabilities (provider, endpoint, path, params_status, verification_status, phase, note) values
  ('redfox', 'RF01', '/story/api/xhs/search/search', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF02', '/story/api/xhsUser/searchArticle', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF03', '/story/api/cozeSkill/getXhsCozeSkillDataOne', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF04', '/story/api/cozeSkill/getXhsCozeSkillDataSeven', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF05', '/story/api/cozeSkill/getLowPowderExplosiveArticle', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF06', '/story/api/xhsUser/searchUser', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF07', '/story/api/xhsUser/queryAccountDetail', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF08', '/story/api/xhsUser/queryWorkList', 'parameter_unverified', 'documented', 'P0', 'account identifier param name unverified'),
  ('redfox', 'RF09', '/story/api/xhsUser/queryWorkDetail', 'documented', 'documented', 'P0', null),
  ('redfox', 'RF10', '/story/api/xhsData/query', 'parameter_unverified', 'documented', 'P0', 'dateType enum unverified'),
  ('redfox', 'RF11', '/story/api/xhs/commentSubmit', 'documented', 'documented', 'P1', 'non-idempotent submit'),
  ('redfox', 'RF12', '/story/api/xhs/commentResult', 'documented', 'documented', 'P1', null),
  ('redfox', 'RF13', '/story/api/parseWork/audioTextExtract/submit/xhs', 'documented', 'documented', 'P1', 'F15; non-idempotent submit'),
  ('redfox', 'RF14', '/story/api/parseWork/audioTextExtract/result/xhs', 'documented', 'documented', 'P1', 'F15'),
  ('redfox', 'RFX1', '/story/api/parseWork/videoDownload/xhs', 'not_implemented', 'unavailable', 'excluded', 'excluded by spec 1.4: no downloading others'' media');
