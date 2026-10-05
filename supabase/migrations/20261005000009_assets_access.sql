-- Asset access through the app gateway: owner, or a cohort reviewer while the
-- submission that attached it is active (spec F10). Evidence files: org admins.

create table public.plan_assets (
  plan_id uuid not null,
  asset_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (plan_id, asset_id),
  foreign key (org_id, plan_id) references public.plans(org_id, id) on delete cascade,
  foreign key (org_id, asset_id) references public.assets(org_id, id) on delete cascade
);
alter table public.plan_assets enable row level security;
create policy via_plan on public.plan_assets for all to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and p.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.plans p where p.id = plan_id and p.org_id = plan_assets.org_id and p.owner_user_id = auth.uid())
              and exists (select 1 from public.assets a where a.id = asset_id and a.owner_user_id = auth.uid()));
grant select, insert, delete on public.plan_assets to authenticated;

create or replace function app.can_read_asset(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assets a
    where a.id = p_asset and a.deleted_at is null and a.state = 'ready' and (a.expires_at is null or a.expires_at > now())
      and (
        (a.owner_user_id = auth.uid() and app.is_member(a.org_id))
        or (a.purpose = 'permission_evidence' and app.has_role(a.org_id, array['org_admin']))
        or exists (
          select 1 from public.submission_assets sa join public.submissions s on s.id = sa.submission_id
          where sa.asset_id = a.id and s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id))
      )
  )
$$;
revoke all on function app.can_read_asset(uuid) from public;
grant execute on function app.can_read_asset(uuid) to authenticated;

-- Storage key and type, returned only when the caller may read the asset.
create or replace function app.asset_meta(p_asset uuid)
returns table (storage_key text, mime text, original_name text)
language sql stable security definer set search_path = '' as $$
  select a.storage_key, a.mime, a.original_name from public.assets a where a.id = p_asset and app.can_read_asset(p_asset)
$$;
revoke all on function app.asset_meta(uuid) from public;
grant execute on function app.asset_meta(uuid) to authenticated;
