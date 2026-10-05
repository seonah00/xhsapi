-- Audit provider permission and organization settings changes (redacted metadata).
create or replace function app.audit_ops() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb;
  target uuid;
  v_org uuid;
begin
  if tg_table_name = 'provider_permissions' then
    v_org := new.org_id; target := new.id;
    meta := jsonb_build_object('provider', new.provider, 'status', new.status, 'endpoints', new.allowed_endpoints,
      'allow', jsonb_build_object('fetch', new.allow_fetch, 'metadata', new.allow_metadata_display, 'excerpt', new.allow_excerpt_display,
        'media', new.allow_media_display, 'ai', new.allow_ai_processing, 'cache', new.allow_cache), 'expires_at', new.expires_at);
  else
    if new.settings is not distinct from old.settings then return new; end if;
    v_org := new.id; target := new.id;
    meta := jsonb_build_object('provider_switches', new.settings -> 'provider_switches', 'feature_switches', new.settings -> 'feature_switches', 'daily_limits', new.settings -> 'daily_limits');
  end if;
  insert into public.audit_events (org_id, actor_id, action, target_type, target_id, redacted_metadata)
  values (v_org, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, target, meta);
  return new;
end $$;
create trigger provider_permissions_audit after insert or update on public.provider_permissions for each row execute function app.audit_ops();
create trigger organizations_settings_audit after update of settings on public.organizations for each row execute function app.audit_ops();

-- Budgets: org admins may set limits (never below what is already reserved/settled — table check enforces).
create policy admin_write on public.usage_budgets for all to authenticated
  using (app.has_role(org_id, array['org_admin'])) with check (app.has_role(org_id, array['org_admin']) and updated_by = auth.uid());
grant insert, update on public.usage_budgets to authenticated;
create trigger usage_budgets_audit after insert or update of amount_limit on public.usage_budgets for each row execute function app.audit_row();

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  meta jsonb;
begin
  meta := to_jsonb(r);
  if tg_table_name = 'invitations' then
    meta := jsonb_build_object('role', meta->'role', 'cohort_id', meta->'cohort_id', 'used', meta->>'used_at' is not null, 'revoked', meta->>'revoked_at' is not null);
  elsif tg_table_name = 'cohorts' then
    meta := jsonb_build_object('name', meta->'name', 'status', meta->'status');
  elsif tg_table_name = 'cohort_members' then
    meta := jsonb_build_object('cohort_id', meta->'cohort_id', 'user_id', meta->'user_id', 'role', meta->'role', 'status', meta->'status');
  elsif tg_table_name = 'usage_budgets' then
    meta := jsonb_build_object('subject_type', meta->'subject_type', 'currency', meta->'currency', 'amount_limit', meta->'amount_limit', 'period_start', meta->'period_start');
  else
    meta := '{}'::jsonb;
  end if;
  insert into public.audit_events (org_id, actor_id, action, target_type, target_id, redacted_metadata)
  values (r.org_id, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, r.id, meta);
  return r;
end $$;
