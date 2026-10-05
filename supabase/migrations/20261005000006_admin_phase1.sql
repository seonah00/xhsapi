-- Admin phase 1: member directory, audit for invitations/cohorts, cohort role consistency.

-- Org admins need member emails; authenticated users cannot read auth.users.
-- Returns rows only for org admins of p_org (empty otherwise).
create or replace function app.member_directory(p_org uuid)
returns table (user_id uuid, email text, role text, status text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email, m.role, m.status, m.created_at
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.org_id = p_org and app.has_role(p_org, array['org_admin'])
  order by m.role, u.email
$$;
revoke all on function app.member_directory(uuid) from public;
grant execute on function app.member_directory(uuid) to authenticated;

-- Generic audit trigger (redacted metadata only: no tokens, no free text).
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  meta jsonb;
begin
  -- to_jsonb avoids referencing columns that the other tables lack.
  meta := to_jsonb(r);
  if tg_table_name = 'invitations' then
    meta := jsonb_build_object('role', meta->'role', 'cohort_id', meta->'cohort_id', 'used', meta->>'used_at' is not null, 'revoked', meta->>'revoked_at' is not null);
  elsif tg_table_name = 'cohorts' then
    meta := jsonb_build_object('name', meta->'name', 'status', meta->'status');
  elsif tg_table_name = 'cohort_members' then
    meta := jsonb_build_object('cohort_id', meta->'cohort_id', 'user_id', meta->'user_id', 'role', meta->'role', 'status', meta->'status');
  else
    meta := '{}'::jsonb;
  end if;
  insert into public.audit_events (org_id, actor_id, action, target_type, target_id, redacted_metadata)
  values (r.org_id, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, r.id, meta);
  return r;
end $$;

create trigger invitations_audit after insert or update on public.invitations for each row execute function app.audit_row();
create trigger cohorts_audit after insert or update on public.cohorts for each row execute function app.audit_row();
create trigger cohort_members_audit after insert or update on public.cohort_members for each row execute function app.audit_row();

-- Cohort role must match the org role: students as students, reviewers from reviewer/org_admin.
create or replace function app.check_cohort_member_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  select role into v_role from public.memberships where org_id = new.org_id and user_id = new.user_id;
  if (new.role = 'student' and v_role <> 'student') or (new.role = 'reviewer' and v_role not in ('reviewer', 'org_admin')) then
    raise exception 'COHORT_ROLE_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger cohort_members_role before insert or update of role, user_id on public.cohort_members
  for each row execute function app.check_cohort_member_role();

-- Invitations are hidden from non-admins already; token hashes never leave the DB via the app.
