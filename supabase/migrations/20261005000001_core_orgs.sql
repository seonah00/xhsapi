-- M0 core: organizations, memberships, cohorts, invitations, audit, consent.
-- Every org-scoped table uses RLS. Composite (org_id, id) keys let children
-- reference parents with the same org_id, so cross-org links fail at the DB level.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  -- Validated by the app (Zod). provider_switches lives here (spec F12).
  settings jsonb not null default '{"provider_switches": {"live": false}}'::jsonb check (jsonb_typeof(settings) = 'object'),
  revision integer not null default 1,
  retention_policy_version text not null default 'draft-2026-10',
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'reviewer', 'org_admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.cohort_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cohort_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'reviewer')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  foreign key (org_id, cohort_id) references public.cohorts(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references public.memberships(org_id, user_id) on delete cascade,
  unique (cohort_id, user_id, role)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_id uuid,
  email text,
  token_hash text not null unique check (length(token_hash) = 64),
  role text not null check (role in ('student', 'reviewer', 'org_admin')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, cohort_id) references public.cohorts(org_id, id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  redacted_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_org_created on public.audit_events (org_id, created_at desc);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('reference_sharing', 'external_ai_processing', 'external_provider_query', 'ocr', 'transcript')),
  policy_version text not null,
  scope jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so policies can consult membership
-- tables without recursive RLS. They only ever answer for auth.uid().
-- ---------------------------------------------------------------------------
create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active' and o.status = 'active'
  )
$$;

create or replace function app.has_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active' and o.status = 'active'
      and m.role = any (p_roles)
  )
$$;

create or replace function app.is_cohort_reviewer(p_cohort uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cohort_members cm
    join public.cohorts c on c.id = cm.cohort_id and c.status = 'active'
    where cm.cohort_id = p_cohort and cm.user_id = auth.uid() and cm.role = 'reviewer' and cm.status = 'active'
      and app.has_role(cm.org_id, array['reviewer', 'org_admin'])
  )
$$;

create or replace function app.audit(p_org uuid, p_action text, p_target_type text, p_target_id uuid, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (org_id, actor_id, action, target_type, target_id, redacted_metadata)
  values (p_org, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb))
$$;

revoke all on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, text[]), app.is_cohort_reviewer(uuid) to authenticated, service_role;
grant execute on function app.audit(uuid, text, text, uuid, jsonb) to service_role;

-- Last active org_admin cannot be removed or demoted (spec 8, F01).
create or replace function app.guard_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(old.org_id, new.org_id);
begin
  if old.role = 'org_admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'org_admin' or new.status <> 'active') then
    if not exists (
      select 1 from public.memberships
      where org_id = v_org and role = 'org_admin' and status = 'active' and id <> old.id
    ) then
      raise exception 'LAST_ADMIN: assign another org_admin first' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger memberships_guard_last_admin
  before update or delete on public.memberships
  for each row execute function app.guard_last_admin();

-- Audit every membership change.
create or replace function app.audit_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (org_id, actor_id, action, target_type, target_id, redacted_metadata)
  values (coalesce(new.org_id, old.org_id), auth.uid(), 'membership.' || lower(tg_op), 'membership', coalesce(new.id, old.id),
          jsonb_build_object('role', coalesce(new.role, old.role), 'status', coalesce(new.status, old.status)));
  return coalesce(new, old);
end $$;

create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_membership();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;
alter table public.consent_records enable row level security;

create policy org_select on public.organizations for select to authenticated using (app.is_member(id));
create policy org_update on public.organizations for update to authenticated
  using (app.has_role(id, array['org_admin'])) with check (app.has_role(id, array['org_admin']));

create policy membership_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.has_role(org_id, array['org_admin']));
create policy membership_admin_write on public.memberships for all to authenticated
  using (app.has_role(org_id, array['org_admin'])) with check (app.has_role(org_id, array['org_admin']));

create policy cohort_select on public.cohorts for select to authenticated using (app.is_member(org_id));
create policy cohort_admin_write on public.cohorts for all to authenticated
  using (app.has_role(org_id, array['org_admin'])) with check (app.has_role(org_id, array['org_admin']));

create policy cohort_member_select on public.cohort_members for select to authenticated
  using (user_id = auth.uid() or app.has_role(org_id, array['org_admin']) or app.is_cohort_reviewer(cohort_id));
create policy cohort_member_admin_write on public.cohort_members for all to authenticated
  using (app.has_role(org_id, array['org_admin'])) with check (app.has_role(org_id, array['org_admin']));

create policy invitation_admin on public.invitations for all to authenticated
  using (app.has_role(org_id, array['org_admin'])) with check (app.has_role(org_id, array['org_admin']) and created_by = auth.uid());

create policy audit_admin_select on public.audit_events for select to authenticated
  using (org_id is not null and app.has_role(org_id, array['org_admin']));

create policy consent_own on public.consent_records for all to authenticated
  using (user_id = auth.uid() and app.is_member(org_id))
  with check (user_id = auth.uid() and app.is_member(org_id));

grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.memberships, public.cohorts, public.cohort_members, public.invitations to authenticated;
grant select on public.audit_events to authenticated;
grant select, insert, update on public.consent_records to authenticated;

-- Invitation redemption: single use, unexpired, unrevoked. Token arrives in
-- plaintext from the link and is compared by SHA-256 hash only.
create or replace function app.redeem_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_inv from public.invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    for update;
  if not found or v_inv.used_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'INVITATION_INVALID' using errcode = 'P0001';
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do nothing;
  if v_inv.cohort_id is not null and v_inv.role in ('student', 'reviewer') then
    insert into public.cohort_members (org_id, cohort_id, user_id, role)
      values (v_inv.org_id, v_inv.cohort_id, v_uid, v_inv.role)
      on conflict (cohort_id, user_id, role) do nothing;
  end if;
  update public.invitations set used_at = now(), used_by = v_uid where id = v_inv.id;
  perform app.audit(v_inv.org_id, 'invitation.redeemed', 'invitation', v_inv.id, '{}'::jsonb);
  return v_inv.org_id;
end $$;
revoke all on function app.redeem_invitation(text) from public;
grant execute on function app.redeem_invitation(text) to authenticated;
