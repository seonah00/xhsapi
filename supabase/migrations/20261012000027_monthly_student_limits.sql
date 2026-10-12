-- Monthly student quotas; monetary budgets and feature switches remain unchanged.
update public.organizations set settings=settings || jsonb_build_object('monthly_limits',jsonb_build_object(
 'provider_search',coalesce((settings->'daily_limits'->>'provider_search')::int,10)*30,
 'ai',coalesce((settings->'daily_limits'->>'ai')::int,20)*30,
 'transcript',coalesce((settings->'daily_limits'->>'transcript')::int,5)*30)) where not settings ? 'monthly_limits';
update public.organizations set settings=jsonb_set(settings,'{auto_search}',(settings->'auto_search') || jsonb_build_object('perMonth',coalesce((settings->'auto_search'->>'perDay')::int,10)*30,'perStudent',coalesce((settings->'auto_search'->>'perStudent')::int,3)*30)) where jsonb_typeof(settings->'auto_search')='object' and not (settings->'auto_search') ? 'perMonth';
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
  v_limit int;
  v_kinds text[];
  v_feature text;
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

  v_feature := case when p_job_kind in ('provider_search','note_enrichment') then 'provider_search' when p_job_kind='transcript_submit' then 'transcript' else 'ai' end;
  v_kinds := case v_feature when 'provider_search' then array['provider_search','note_enrichment'] when 'transcript' then array['transcript_submit'] else array['reference_analysis','query_expansion','plan_generation','contextual_check','results_reflection'] end;
  perform pg_advisory_xact_lock(hashtextextended('monthly:' || p_org::text || v_uid::text || v_feature,0));
  select coalesce((settings->'monthly_limits'->>v_feature)::int,case v_feature when 'provider_search' then 300 when 'transcript' then 150 else 600 end) into v_limit from public.organizations where id=p_org;
  if (select count(*) from public.app_jobs where org_id=p_org and owner_user_id=v_uid and kind=any(v_kinds) and created_at >= (date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')) >= v_limit then
    raise exception 'MONTHLY_LIMIT' using errcode='P0001';
  end if;

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

create or replace function app.dictionary_ai_capacity(p_org uuid)
returns table (user_daily_used integer, global_cap_available boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day_start timestamp := date_trunc('month', now() at time zone 'Asia/Seoul');
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

create or replace function app.reserve_dictionary_ai_usage(p_org uuid, p_nonce_hash text)
returns table (usage_id uuid, reserved_max_cost_usd numeric, user_daily_used integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day_start timestamp := date_trunc('month', now() at time zone 'Asia/Seoul');
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
  if v_daily >= 90 then raise exception 'DICTIONARY_AI_DAILY_LIMIT' using errcode = 'P0001'; end if;

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
