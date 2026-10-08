-- Bounded, authenticated Gemini composer usage. Preview contexts and generated
-- content are never stored here: this table contains reservation/usage metadata only.

create table public.dictionary_ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  model text not null default 'gemini-3.8-flash' check (model = 'gemini-3.8-flash'),
  reserved_max_cost_usd numeric(8, 6) not null default 0.060000
    check (reserved_max_cost_usd > 0 and reserved_max_cost_usd <= 0.060000),
  outcome text not null default 'reserved' check (outcome in ('reserved', 'succeeded', 'failed')),
  prompt_token_count integer check (prompt_token_count is null or prompt_token_count between 0 and 100000),
  candidates_token_count integer check (candidates_token_count is null or candidates_token_count between 0 and 100000),
  total_token_count integer check (total_token_count is null or total_token_count between 0 and 200000),
  created_at timestamptz not null default now(),
  completed_at timestamptz
  -- Deliberately no cascading membership FK: leaving/deleting a membership must
  -- not erase already-reserved costs and reopen the deployment-wide monthly cap.
  -- The reservation function validates active membership before every insert.
);
create index dictionary_ai_usage_user_day on public.dictionary_ai_usage (user_id, created_at desc);
create index dictionary_ai_usage_month on public.dictionary_ai_usage (created_at, reserved_max_cost_usd);

alter table public.dictionary_ai_usage enable row level security;
create policy own_metadata on public.dictionary_ai_usage for select to authenticated
  using (user_id = auth.uid() and app.is_member(org_id));
grant select on public.dictionary_ai_usage to authenticated;

-- Status exposes only the caller's count and a global capacity boolean, never
-- another user's rows or prompts/results (which are not stored at all).
create or replace function app.dictionary_ai_capacity(p_org uuid)
returns table (user_daily_used integer, global_cap_available boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day_start timestamp := date_trunc('day', now() at time zone 'Asia/Seoul');
  v_month_start timestamp := date_trunc('month', now() at time zone 'Asia/Seoul');
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not app.is_member(p_org) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return query
    select
      (select count(*)::integer from public.dictionary_ai_usage u
        where u.user_id = v_uid and (u.created_at at time zone 'Asia/Seoul') >= v_day_start),
      (select coalesce(sum(u.reserved_max_cost_usd), 0) + 0.060000 <= 5.000000
         from public.dictionary_ai_usage u
        where (u.created_at at time zone 'Asia/Seoul') >= v_month_start);
end $$;

-- Limits are constants here, not caller parameters: authenticated clients cannot
-- raise a limit, choose a user, lower the reservation, or change the model.
create or replace function app.reserve_dictionary_ai_usage(p_org uuid, p_nonce_hash text)
returns table (usage_id uuid, reserved_max_cost_usd numeric, user_daily_used integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day_start timestamp := date_trunc('day', now() at time zone 'Asia/Seoul');
  v_month_start timestamp := date_trunc('month', now() at time zone 'Asia/Seoul');
  v_daily integer;
  v_monthly numeric(12, 6);
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not app.is_member(p_org) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  -- One deployment-wide lock makes the monthly cap and nonce replay check atomic.
  perform pg_advisory_xact_lock(hashtextextended('dictionary-ai:' || to_char(v_month_start, 'YYYY-MM'), 0));

  if exists (select 1 from public.dictionary_ai_usage where nonce_hash = p_nonce_hash) then
    raise exception 'DICTIONARY_AI_REPLAY' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_daily
    from public.dictionary_ai_usage u
   where u.user_id = v_uid and (u.created_at at time zone 'Asia/Seoul') >= v_day_start;
  if v_daily >= 3 then raise exception 'DICTIONARY_AI_DAILY_LIMIT' using errcode = 'P0001'; end if;

  select coalesce(sum(u.reserved_max_cost_usd), 0) into v_monthly
    from public.dictionary_ai_usage u
   where (u.created_at at time zone 'Asia/Seoul') >= v_month_start;
  if v_monthly + 0.060000 > 5.000000 then
    raise exception 'DICTIONARY_AI_GLOBAL_CAP' using errcode = 'P0001';
  end if;

  insert into public.dictionary_ai_usage (org_id, user_id, nonce_hash)
  values (p_org, v_uid, p_nonce_hash)
  returning id into v_id;

  return query select v_id, 0.060000::numeric, v_daily + 1;
end $$;

create or replace function app.finish_dictionary_ai_usage(
  p_usage uuid,
  p_outcome text,
  p_prompt_tokens integer default null,
  p_candidate_tokens integer default null,
  p_total_tokens integer default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.dictionary_ai_usage;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_outcome not in ('succeeded', 'failed') then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  if p_prompt_tokens is not null and (p_prompt_tokens < 0 or p_prompt_tokens > 100000) then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  if p_candidate_tokens is not null and (p_candidate_tokens < 0 or p_candidate_tokens > 100000) then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  if p_total_tokens is not null and (p_total_tokens < 0 or p_total_tokens > 200000) then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;

  select * into v_row from public.dictionary_ai_usage where id = p_usage for update;
  if not found or v_row.user_id <> v_uid or not app.is_member(v_row.org_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.outcome <> 'reserved' then return false; end if;

  update public.dictionary_ai_usage
     set outcome = p_outcome,
         prompt_token_count = p_prompt_tokens,
         candidates_token_count = p_candidate_tokens,
         total_token_count = p_total_tokens,
         completed_at = now()
   where id = p_usage;
  return true;
end $$;

revoke all on function app.dictionary_ai_capacity(uuid), app.reserve_dictionary_ai_usage(uuid, text),
  app.finish_dictionary_ai_usage(uuid, text, integer, integer, integer) from public;
grant execute on function app.dictionary_ai_capacity(uuid), app.reserve_dictionary_ai_usage(uuid, text),
  app.finish_dictionary_ai_usage(uuid, text, integer, integer, integer) to authenticated;
