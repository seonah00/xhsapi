-- XHS Studio 초기 스키마 (자동 생성: pnpm db:sql). 새 Supabase 프로젝트의 SQL Editor에 한 번만 붙여 넣어 실행하세요.

-- 데모 데이터(seed.sql)는 포함하지 않습니다. 이후 업데이트는 pnpm db:migrate 로 적용합니다.

do $$ declare already boolean := false; begin
  if to_regclass('app.applied_migrations') is not null then
    execute 'select exists (select 1 from app.applied_migrations)' into already;
  end if;
  if already then raise exception '이미 스키마가 적용된 DB입니다. 업데이트는 pnpm db:migrate 를 사용하세요.'; end if;
end $$;

create schema if not exists app;
create table if not exists app.applied_migrations (version text primary key, name text not null, applied_at timestamptz not null default now());
revoke all on app.applied_migrations from public;

-- ==== 20261005000001_core_orgs.sql ====

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

insert into app.applied_migrations (version, name) values ('20261005000001', '20261005000001_core_orgs.sql');

-- ==== 20261005000002_accounts_content.sql ====

-- M0/M1 content: creator accounts, taxonomy, provider notes, references,
-- keywords, expressions, saves, analyses, F15 transcripts, reference accounts.

-- Immutability guard for version tables. Deletion only by the purge job
-- (service role sets app.allow_purge = 'on' inside its transaction).
create or replace function app.block_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'IMMUTABLE: % rows cannot be %', tg_table_name, lower(tg_op) using errcode = 'P0001';
end $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table public.creator_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  display_name text not null check (length(display_name) between 1 and 80),
  platform text not null default 'xiaohongshu' check (platform = 'xiaohongshu'),
  profile_url text,
  current_profile_version_id uuid,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  unique (org_id, id)
);
create index creator_accounts_owner on public.creator_accounts (org_id, owner_user_id, updated_at desc);
create trigger creator_accounts_touch before update on public.creator_accounts for each row execute function app.touch_updated_at();

-- Spec F02: active accounts per user default limit 3 (org setting max_active_accounts overrides).
create or replace function app.enforce_account_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.deleted_at is not null then return new; end if;
  select coalesce((settings ->> 'max_active_accounts')::integer, 3) into v_limit from public.organizations where id = new.org_id;
  select count(*) into v_count from public.creator_accounts
    where org_id = new.org_id and owner_user_id = new.owner_user_id and deleted_at is null and id <> new.id;
  if v_count >= v_limit then raise exception 'ACCOUNT_LIMIT: % active accounts max', v_limit using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger creator_accounts_limit before insert or update of deleted_at on public.creator_accounts
  for each row execute function app.enforce_account_limit();

create table public.account_profile_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  account_id uuid not null,
  version integer not null check (version > 0),
  profile_json jsonb not null check (jsonb_typeof(profile_json) = 'object'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, account_id) references public.creator_accounts(org_id, id) on delete cascade,
  unique (account_id, version),
  unique (org_id, id)
);
create trigger account_profile_versions_immutable before update or delete on public.account_profile_versions
  for each row execute function app.block_mutation();
alter table public.creator_accounts
  add constraint creator_accounts_current_profile_fk foreign key (org_id, current_profile_version_id)
  references public.account_profile_versions(org_id, id) deferrable initially deferred;

create table public.taxonomy_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = global default
  kind text not null check (kind in ('topic', 'format', 'subtopic', 'purpose', 'region', 'search_seed')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  label_ko text not null,
  label_zh text,
  parent_id uuid references public.taxonomy_terms(id),
  mapping_json jsonb not null default '{}'::jsonb,
  provenance text not null default 'editorial_seed' check (provenance in ('editorial_seed', 'observed_tag', 'ai_suggestion')),
  version integer not null default 1,
  active boolean not null default true
);
create unique index taxonomy_terms_slug on public.taxonomy_terms (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, slug, version);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  endpoint text not null,
  data_mode text not null check (data_mode in ('mock', 'live')),
  query_hash text not null,
  normalized_params jsonb not null default '{}'::jsonb,
  window_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  actual_fetched_at timestamptz,
  coverage_json jsonb not null default '{}'::jsonb,
  permission_id uuid,
  collection_strategy_version text not null default 'v1',
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  platform_note_id text not null,
  data_mode text not null check (data_mode in ('mock', 'live')),
  canonical_url text not null,
  note_type text check (note_type in ('video', 'image')),
  title text,
  body_excerpt text,
  author_ref text,
  author_display_name text,
  published_at timestamptz,
  published_at_raw text, -- provider original, kept when only a date was given
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  provider_tags text[] not null default '{}',
  is_fallback boolean not null default false, -- latestHotArticles etc.: never in recommendations
  ingestion_run_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, platform_note_id, data_mode),
  unique (org_id, id),
  foreign key (org_id, ingestion_run_id) references public.ingestion_runs(org_id, id)
);
create index notes_published on public.notes (org_id, data_mode, published_at desc);
create trigger notes_touch before update on public.notes for each row execute function app.touch_updated_at();

create table public.note_taxonomy (
  note_id uuid not null references public.notes(id) on delete cascade,
  taxonomy_id uuid not null references public.taxonomy_terms(id),
  classifier_version text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  reviewed_by uuid,
  primary key (note_id, taxonomy_id)
);

create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  observed_at timestamptz not null,
  provider_snapshot_at timestamptz,
  rank_date date,
  window_json jsonb not null default '{}'::jsonb,
  -- Each metric is a MetricValue {raw, exact, lowerBound, upperBound, precision}; missing stays null.
  metrics_json jsonb not null check (jsonb_typeof(metrics_json) = 'object'),
  ingestion_run_id uuid references public.ingestion_runs(id)
);
create index metric_snapshots_note on public.metric_snapshots (note_id, observed_at desc);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  name text not null check (length(name) between 1 and 80),
  visibility text not null default 'private' check (visibility = 'private'),
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  unique (org_id, id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  storage_key text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'text/csv')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  origin text not null check (origin in ('user_upload', 'generated')),
  rights_scope text not null default 'owner_only' check (rights_scope in ('owner_only', 'shareable_with_reviewer', 'org_library')),
  state text not null default 'pending' check (state in ('pending', 'ready', 'rejected')),
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  unique (org_id, id)
);

create table public.reference_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  source_type text not null check (source_type in ('saved_note', 'manual_url', 'pasted_text', 'image')),
  note_id uuid,
  manual_url text,
  user_text text check (length(user_text) <= 20000),
  user_memo text check (length(user_memo) <= 5000),
  analysis_scope text[] not null default '{metadata_only}',
  visibility text not null default 'private' check (visibility = 'private'),
  license_assertion text not null default 'reference_only' check (license_assertion in ('reference_only', 'own_content', 'licensed')),
  collection_id uuid,
  tags text[] not null default '{}',
  favorite boolean not null default false,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, note_id) references public.notes(org_id, id),
  foreign key (org_id, collection_id) references public.collections(org_id, id) on delete set null (collection_id),
  check (analysis_scope <@ array['metadata_only', 'body_only', 'cover_and_body', 'audio_transcript', 'selected_frames', 'full_video', 'user_notes_only']),
  unique (org_id, id)
);
create index reference_items_owner on public.reference_items (org_id, owner_user_id, updated_at desc);
create trigger reference_items_touch before update on public.reference_items for each row execute function app.touch_updated_at();

create table public.reference_assets (
  reference_id uuid not null,
  asset_id uuid not null,
  org_id uuid not null,
  primary key (reference_id, asset_id),
  foreign key (org_id, reference_id) references public.reference_items(org_id, id) on delete cascade,
  foreign key (org_id, asset_id) references public.assets(org_id, id) on delete cascade
);

-- Immutable published snapshot (spec F05). Revocation hides; it never edits content.
create table public.reference_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_reference_id uuid not null,
  source_revision integer not null,
  source_owner_user_id uuid not null,
  snapshot_json jsonb not null,
  content_hash text not null,
  consent_record_id uuid not null,
  permission_id uuid,
  reviewed_by uuid not null,
  published_at timestamptz not null default now(),
  status text not null default 'published' check (status in ('published', 'revoked', 'expired')),
  status_reason text,
  expires_at timestamptz,
  foreign key (org_id, source_reference_id) references public.reference_items(org_id, id),
  foreign key (org_id, consent_record_id) references public.consent_records(org_id, id)
);
create or replace function app.reference_publication_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.snapshot_json is distinct from old.snapshot_json or new.content_hash is distinct from old.content_hash
     or new.source_reference_id is distinct from old.source_reference_id or new.source_revision is distinct from old.source_revision) then
    raise exception 'IMMUTABLE: publication snapshot cannot change' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'published' and new.status = 'published' then
    raise exception 'REPUBLISH_REQUIRES_NEW_SNAPSHOT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger reference_publications_guard before update on public.reference_publications
  for each row execute function app.reference_publication_guard();

create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  canonical_text text not null,
  raw_text text not null,
  kind text not null check (kind in ('hashtag', 'phrase')),
  provenance text not null check (provenance in ('observed_tag', 'observed_phrase', 'provider_related_term', 'editorial_seed', 'ai_suggestion', 'official_search_metric')),
  meaning_ko text,
  topics text[] not null default '{}',
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewer_checked', 'published', 'retired')),
  data_mode text not null check (data_mode in ('mock', 'live')),
  created_at timestamptz not null default now(),
  -- No P0 path may create official search metrics (spec F06).
  check (provenance <> 'official_search_metric'),
  unique (org_id, canonical_text, kind, provenance, data_mode)
);
create index keywords_lookup on public.keywords (org_id, provenance, data_mode);

create table public.keyword_occurrences (
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  field text not null check (field in ('title', 'body', 'tags', 'transcript')),
  span int4range,
  ingestion_run_id uuid references public.ingestion_runs(id),
  primary key (keyword_id, note_id, field) -- repeated use in one note counts once
);

create table public.trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  data_mode text not null check (data_mode in ('mock', 'live')),
  collection_strategy_version text not null,
  windows_json jsonb not null,
  counts_json jsonb not null,
  status text not null check (status in ('comparable', 'insufficient_evidence', 'newly_observed')),
  evidence_refs uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.expressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid, -- null = org dictionary; set = personal (AI/own) entry
  expression text not null,
  explanations_json jsonb not null default '{}'::jsonb,
  tone text,
  contexts_json jsonb not null default '{}'::jsonb,
  topics text[] not null default '{}',
  expression_type text not null default 'basic' check (expression_type in ('basic', 'observed_recent', 'trend_unverified')),
  provenance text not null check (provenance in ('editorial', 'observed', 'ai_suggestion', 'transcript_observed')),
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewer_checked', 'published', 'retired')),
  version integer not null default 1,
  data_mode text not null default 'mock' check (data_mode in ('mock', 'live')),
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  -- AI output is never published straight into the shared dictionary.
  check (not (provenance = 'ai_suggestion' and owner_user_id is null and review_status = 'published'))
);

create table public.expression_evidence (
  id uuid primary key default gen_random_uuid(),
  expression_id uuid not null references public.expressions(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  reference_id uuid references public.reference_items(id) on delete cascade,
  observed_at timestamptz not null,
  quote_excerpt text check (length(quote_excerpt) <= 200),
  check (num_nonnulls(note_id, reference_id) = 1)
);

create table public.personal_saves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  target_type text not null check (target_type in ('note', 'keyword', 'expression', 'reference_publication')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  unique (owner_user_id, target_type, target_id)
);

-- Polymorphic target must exist in the same org (spec 7: no arbitrary UUID links).
create or replace function app.check_save_target() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ok boolean;
begin
  ok := case new.target_type
    when 'note' then exists (select 1 from public.notes where id = new.target_id and org_id = new.org_id)
    when 'keyword' then exists (select 1 from public.keywords where id = new.target_id and org_id = new.org_id)
    when 'expression' then exists (select 1 from public.expressions where id = new.target_id and org_id = new.org_id
                                   and (owner_user_id is null and review_status = 'published' or owner_user_id = new.owner_user_id))
    when 'reference_publication' then exists (select 1 from public.reference_publications where id = new.target_id and org_id = new.org_id and status = 'published')
  end;
  if not coalesce(ok, false) then raise exception 'INVALID_TARGET' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger personal_saves_target before insert or update on public.personal_saves
  for each row execute function app.check_save_target();

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  target_type text not null check (target_type in ('reference', 'plan_version', 'result_set', 'query')),
  target_id uuid not null,
  input_hash text not null,
  analysis_scope text[] not null,
  schema_version text not null,
  prompt_version text not null,
  model text,
  data_mode text not null check (data_mode in ('mock', 'live')),
  output_json jsonb,
  status text not null check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade
);

create table public.reference_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  provider text not null,
  provider_user_id text not null,
  id_kind text not null check (id_kind in ('account_id', 'user_id', 'red_id', 'unknown')),
  display_name text not null,
  profile_url text,
  snapshot_json jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  data_mode text not null check (data_mode in ('mock', 'live')),
  permission_id uuid,
  expires_at timestamptz,
  saved_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  unique (owner_user_id, provider, provider_user_id, data_mode)
);

-- F15 audio transcripts (spec 1.1). Full text only when permission allows cache + excerpt display.
create table public.transcript_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  reference_id uuid not null,
  note_id uuid,
  data_mode text not null check (data_mode in ('mock', 'live')),
  provider text not null,
  provider_task_id text,
  job_id uuid,
  status text not null default 'queued' check (status in ('queued', 'submitted', 'processing', 'succeeded', 'failed', 'no_speech', 'unknown_outcome')),
  fail_code text check (fail_code in ('provider_failed', 'not_video', 'no_speech_detected', 'unknown', 'permission_revoked')),
  full_text text,
  text_stored boolean not null default false,
  duration_ms integer,
  permission_id uuid,
  quote_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, reference_id) references public.reference_items(org_id, id) on delete cascade,
  foreign key (org_id, note_id) references public.notes(org_id, id),
  check (text_stored or full_text is null),
  unique (org_id, id)
);
create unique index transcript_runs_one_success on public.transcript_runs (org_id, note_id, data_mode) where status = 'succeeded';
create trigger transcript_runs_touch before update on public.transcript_runs for each row execute function app.touch_updated_at();

create table public.transcript_segments (
  run_id uuid not null references public.transcript_runs(id) on delete cascade,
  seq integer not null check (seq >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  text_seg text,
  excerpt text check (length(excerpt) <= 40),
  masked boolean not null default false,
  primary key (run_id, seq)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.creator_accounts enable row level security;
alter table public.account_profile_versions enable row level security;
alter table public.taxonomy_terms enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.notes enable row level security;
alter table public.note_taxonomy enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.collections enable row level security;
alter table public.assets enable row level security;
alter table public.reference_items enable row level security;
alter table public.reference_assets enable row level security;
alter table public.reference_publications enable row level security;
alter table public.keywords enable row level security;
alter table public.keyword_occurrences enable row level security;
alter table public.trend_snapshots enable row level security;
alter table public.expressions enable row level security;
alter table public.expression_evidence enable row level security;
alter table public.personal_saves enable row level security;
alter table public.analyses enable row level security;
alter table public.reference_accounts enable row level security;
alter table public.transcript_runs enable row level security;
alter table public.transcript_segments enable row level security;

-- Owner-only private data. Org admins get no bypass (spec 1.2).
create policy owner_all on public.creator_accounts for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_all on public.collections for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_all on public.assets for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_all on public.reference_items for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_all on public.personal_saves for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_all on public.analyses for select to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_all on public.reference_accounts for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
-- Transcripts are produced by the worker; students read/delete their own.
create policy owner_read on public.transcript_runs for select to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));
create policy owner_delete on public.transcript_runs for delete to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));
create policy via_run on public.transcript_segments for select to authenticated
  using (exists (select 1 from public.transcript_runs r where r.id = run_id and r.owner_user_id = auth.uid() and app.is_member(r.org_id)));

create policy via_account on public.account_profile_versions for select to authenticated
  using (exists (select 1 from public.creator_accounts a where a.id = account_id and a.owner_user_id = auth.uid() and app.is_member(a.org_id)));
create policy via_account_insert on public.account_profile_versions for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.creator_accounts a where a.id = account_id and a.org_id = account_profile_versions.org_id and a.owner_user_id = auth.uid()));

create policy via_reference on public.reference_assets for all to authenticated
  using (exists (select 1 from public.reference_items r where r.id = reference_id and r.owner_user_id = auth.uid()))
  with check (
    exists (select 1 from public.reference_items r where r.id = reference_id and r.owner_user_id = auth.uid())
    and exists (select 1 from public.assets s where s.id = asset_id and s.owner_user_id = auth.uid()));

-- Shared org data.
create policy member_read on public.taxonomy_terms for select to authenticated
  using (org_id is null or app.is_member(org_id));
create policy admin_write on public.taxonomy_terms for all to authenticated
  using (org_id is not null and app.has_role(org_id, array['org_admin'])) with check (org_id is not null and app.has_role(org_id, array['org_admin']));

create policy member_read on public.ingestion_runs for select to authenticated using (app.is_member(org_id));
-- Expired provider content is hidden at query time regardless of purge jobs (spec 10.4).
create policy member_read on public.notes for select to authenticated
  using (app.is_member(org_id) and (expires_at is null or expires_at > now()));
create policy via_note on public.note_taxonomy for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id));
create policy via_note on public.metric_snapshots for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id));
create policy via_note on public.keyword_occurrences for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id));
create policy member_read on public.keywords for select to authenticated using (app.is_member(org_id));
create policy member_read on public.trend_snapshots for select to authenticated using (app.is_member(org_id));

create policy published_or_own on public.expressions for select to authenticated
  using (app.is_member(org_id) and ((owner_user_id is null and review_status = 'published')
         or owner_user_id = auth.uid()
         or (owner_user_id is null and app.has_role(org_id, array['reviewer', 'org_admin']))));
create policy own_write on public.expressions for insert to authenticated
  with check (owner_user_id = auth.uid() and app.is_member(org_id) and review_status = 'draft');
create policy staff_write on public.expressions for all to authenticated
  using (owner_user_id is null and app.has_role(org_id, array['reviewer', 'org_admin']))
  with check (owner_user_id is null and app.has_role(org_id, array['reviewer', 'org_admin']));
create policy via_expression on public.expression_evidence for select to authenticated
  using (exists (select 1 from public.expressions e where e.id = expression_id));

create policy library_read on public.reference_publications for select to authenticated
  using (app.is_member(org_id) and status = 'published' and (expires_at is null or expires_at > now()));

grant select, insert, update, delete on public.creator_accounts, public.collections, public.assets, public.reference_items,
  public.reference_assets, public.personal_saves, public.reference_accounts to authenticated;
grant select, insert on public.account_profile_versions to authenticated;
grant select, insert, update, delete on public.taxonomy_terms, public.expressions to authenticated;
grant select on public.ingestion_runs, public.notes, public.note_taxonomy, public.metric_snapshots, public.keywords,
  public.keyword_occurrences, public.trend_snapshots, public.expression_evidence, public.reference_publications,
  public.analyses, public.transcript_segments to authenticated;
grant select, delete on public.transcript_runs to authenticated;

insert into app.applied_migrations (version, name) values ('20261005000002', '20261005000002_accounts_content.sql');

-- ==== 20261005000003_plans_reviews.sql ====

-- M2 core: plans, immutable versions, checks, submissions, feedback, results.
-- Reviewer access is granted only through an active submission in a cohort
-- where the reviewer is an active reviewer (spec F10). Owner policies alone
-- would leave reviewers unable to read real submissions, which is also a defect.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  account_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'planned', 'filming', 'ready', 'user_marked_published', 'archived')),
  current_version_id uuid,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, account_id) references public.creator_accounts(org_id, id),
  unique (org_id, id)
);
create index plans_owner on public.plans (org_id, owner_user_id, updated_at desc);
create trigger plans_touch before update on public.plans for each row execute function app.touch_updated_at();

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  plan_id uuid not null,
  version integer not null check (version > 0),
  kind text not null default 'edit' check (kind in ('edit', 'ai_proposal')),
  profile_version_id uuid,
  fact_sheet_json jsonb not null default '{}'::jsonb,
  content_json jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  check_input_hash text not null check (check_input_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  generation_job_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, plan_id) references public.plans(org_id, id) on delete cascade,
  foreign key (org_id, profile_version_id) references public.account_profile_versions(org_id, id),
  unique (plan_id, version),
  unique (org_id, id)
);
create trigger plan_versions_immutable before update or delete on public.plan_versions
  for each row execute function app.block_mutation();
alter table public.plans add constraint plans_current_version_fk
  foreign key (org_id, current_version_id) references public.plan_versions(org_id, id) deferrable initially deferred;

create table public.check_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = built-in editorial set
  rule_key text not null,
  version integer not null default 1,
  source_class text not null check (source_class in ('official_policy', 'law', 'provider_list', 'instructor_editorial', 'test_editorial')),
  source_url text,
  source_date date,
  reviewed_at timestamptz,
  review_due_at timestamptz,
  scope jsonb not null default '{}'::jsonb,       -- fields/topics the rule applies to
  match_config jsonb not null,                    -- {type: exact_phrase|keyword, value}
  finding_type text not null,
  severity text not null check (severity in ('high', 'medium', 'low', 'info')),
  rationale text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'review_overdue', 'retired')),
  unique (org_id, rule_key, version),
  -- P0 matcher: no user regex or code (spec F09), bounded size.
  check (match_config ->> 'type' in ('exact_phrase', 'keyword') and length(match_config ->> 'value') between 1 and 100),
  -- Official-class rules need source date and scope before activation.
  check (status <> 'active' or source_class in ('instructor_editorial', 'test_editorial') or (source_date is not null and source_url is not null and reviewed_at is not null))
);

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  plan_version_id uuid,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'), -- = check input hash of what was checked
  rules_version text not null,
  job_id uuid,
  status text not null check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  -- e.g. {"rules": "completed", "contextual": "failed"}
  completeness_json jsonb not null default '{}'::jsonb,
  data_mode text not null default 'mock' check (data_mode in ('mock', 'live')),
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, plan_version_id) references public.plan_versions(org_id, id),
  unique (org_id, id)
);

create table public.check_findings (
  id uuid primary key default gen_random_uuid(),
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  field_key text not null check (field_key in ('title', 'cover', 'body', 'tags', 'subtitles', 'document')),
  start_utf16 integer check (start_utf16 >= 0),
  end_utf16 integer,
  finding_type text not null,
  severity text not null check (severity in ('high', 'medium', 'low', 'info')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rule_id uuid references public.check_rules(id),
  anchored boolean not null default true,
  finding_json jsonb not null,
  check ((start_utf16 is null) = (end_utf16 is null)),
  check (end_utf16 is null or end_utf16 > start_utf16)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  cohort_id uuid not null,
  plan_version_id uuid not null,
  check_run_id uuid not null,
  acknowledged_incomplete_check boolean not null default false,
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'changes_requested', 'feedback_complete', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, cohort_id) references public.cohorts(org_id, id),
  foreign key (org_id, plan_version_id) references public.plan_versions(org_id, id),
  foreign key (org_id, check_run_id) references public.check_runs(org_id, id),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  unique (org_id, id)
);
create unique index submissions_one_active on public.submissions (plan_version_id, cohort_id) where status <> 'withdrawn';

create table public.submission_assets (
  submission_id uuid not null,
  asset_id uuid not null,
  org_id uuid not null,
  shared_by uuid not null,
  shared_at timestamptz not null default now(),
  primary key (submission_id, asset_id),
  foreign key (org_id, submission_id) references public.submissions(org_id, id) on delete cascade,
  foreign key (org_id, asset_id) references public.assets(org_id, id) on delete cascade
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id),
  content text not null check (length(content) between 1 and 10000),
  checklist_json jsonb not null default '[]'::jsonb,
  status text not null default 'comment' check (status in ('comment', 'changes_requested', 'feedback_complete')),
  created_at timestamptz not null default now()
);

create table public.publication_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  account_id uuid not null,
  plan_version_id uuid,
  note_url text,
  published_at timestamptz,
  sponsorship text not null default 'unknown' check (sponsorship in ('yes', 'no', 'unknown')),
  paid_promotion text not null default 'unknown' check (paid_promotion in ('yes', 'no', 'unknown')),
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, account_id) references public.creator_accounts(org_id, id),
  foreign key (org_id, plan_version_id) references public.plan_versions(org_id, id),
  unique (org_id, id)
);

create table public.result_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  publication_id uuid not null,
  observed_at timestamptz not null,
  entered_at timestamptz not null default now(),
  metric_source text not null check (metric_source in ('manual', 'user_analytics_export', 'authorized_api')),
  -- views/likes/saves/comments/shares/follows_attributed/search_traffic/impressions: all nullable integers.
  values_json jsonb not null check (jsonb_typeof(values_json) = 'object'),
  attribution_scope text not null default 'post' check (attribution_scope in ('post', 'account_total')),
  foreign key (org_id, publication_id) references public.publication_records(org_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Visibility helper: active submission in a cohort the caller reviews.
-- ---------------------------------------------------------------------------
create or replace function app.reviewer_can_see_version(p_plan_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.plan_version_id = p_plan_version and s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)
  )
$$;
create or replace function app.reviewer_can_see_check(p_check_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.check_run_id = p_check_run and s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)
  )
$$;
grant execute on function app.reviewer_can_see_version(uuid), app.reviewer_can_see_check(uuid) to authenticated;

-- Submission validation (spec F10): owner, cohort membership, check hash match, completeness.
create or replace function app.validate_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pv public.plan_versions;
  v_plan public.plans;
  v_run public.check_runs;
begin
  select * into v_pv from public.plan_versions where id = new.plan_version_id and org_id = new.org_id;
  select * into v_plan from public.plans where id = v_pv.plan_id;
  if v_plan.owner_user_id is distinct from new.owner_user_id or v_plan.deleted_at is not null then
    raise exception 'SUBMISSION_NOT_OWNER' using errcode = 'P0001';
  end if;
  if v_pv.kind <> 'edit' then
    raise exception 'SUBMISSION_PROPOSAL_NOT_APPLIED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                 where cm.cohort_id = new.cohort_id and cm.user_id = new.owner_user_id and cm.role = 'student'
                   and cm.status = 'active' and c.status = 'active') then
    raise exception 'SUBMISSION_NOT_IN_COHORT' using errcode = 'P0001';
  end if;
  select * into v_run from public.check_runs where id = new.check_run_id and org_id = new.org_id;
  if v_run.owner_user_id is distinct from new.owner_user_id then
    raise exception 'SUBMISSION_CHECK_NOT_OWNER' using errcode = 'P0001';
  end if;
  if v_run.content_hash <> v_pv.check_input_hash then
    raise exception 'SUBMISSION_CHECK_STALE' using errcode = 'P0001';
  end if;
  if v_run.status = 'partial' then
    if coalesce(v_run.completeness_json ->> 'rules', '') <> 'completed' then
      raise exception 'SUBMISSION_CHECK_INCOMPLETE' using errcode = 'P0001';
    end if;
    if not new.acknowledged_incomplete_check then
      raise exception 'SUBMISSION_ACK_REQUIRED' using errcode = 'P0001';
    end if;
  elsif v_run.status <> 'completed' then
    raise exception 'SUBMISSION_CHECK_INCOMPLETE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger submissions_validate before insert on public.submissions
  for each row execute function app.validate_submission();

create or replace function app.validate_submission_asset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.submissions s join public.assets a on a.id = new.asset_id
                 where s.id = new.submission_id and s.owner_user_id = new.shared_by and a.owner_user_id = new.shared_by
                   and a.org_id = s.org_id and a.deleted_at is null and a.state = 'ready'
                   and a.rights_scope in ('shareable_with_reviewer', 'org_library')) then
    raise exception 'SUBMISSION_ASSET_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger submission_assets_validate before insert on public.submission_assets
  for each row execute function app.validate_submission_asset();

-- Status changes go through these functions only (no UPDATE grant on submissions).
create or replace function app.withdraw_submission(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  update public.submissions set status = 'withdrawn', withdrawn_at = now()
    where id = p_submission and owner_user_id = auth.uid() and status <> 'withdrawn'
    returning org_id into v_org;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app.audit(v_org, 'submission.withdrawn', 'submission', p_submission, '{}'::jsonb);
end $$;

create or replace function app.add_feedback(p_submission uuid, p_content text, p_status text, p_checklist jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.submissions;
  v_id uuid;
  v_next text;
begin
  select * into v_sub from public.submissions where id = p_submission for update;
  if not found or v_sub.status = 'withdrawn' or not app.is_cohort_reviewer(v_sub.cohort_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_status not in ('comment', 'changes_requested', 'feedback_complete') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  insert into public.feedback (submission_id, reviewer_user_id, content, checklist_json, status)
    values (p_submission, auth.uid(), p_content, coalesce(p_checklist, '[]'::jsonb), p_status) returning id into v_id;
  v_next := case p_status when 'comment' then 'in_review' else p_status end;
  update public.submissions set status = v_next where id = p_submission;
  return v_id;
end $$;

revoke all on function app.withdraw_submission(uuid), app.add_feedback(uuid, text, text, jsonb) from public;
grant execute on function app.withdraw_submission(uuid), app.add_feedback(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.check_rules enable row level security;
alter table public.check_runs enable row level security;
alter table public.check_findings enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_assets enable row level security;
alter table public.feedback enable row level security;
alter table public.publication_records enable row level security;
alter table public.result_snapshots enable row level security;

create policy owner_all on public.plans for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));

create policy owner_or_reviewer_read on public.plan_versions for select to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and p.owner_user_id = auth.uid() and app.is_member(p.org_id))
         or app.reviewer_can_see_version(id));
create policy owner_insert on public.plan_versions for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.plans p where p.id = plan_id and p.org_id = plan_versions.org_id and p.owner_user_id = auth.uid()));

create policy member_read on public.check_rules for select to authenticated
  using (org_id is null or app.is_member(org_id));
create policy admin_write on public.check_rules for all to authenticated
  using (org_id is not null and app.has_role(org_id, array['org_admin', 'reviewer']))
  with check (org_id is not null and app.has_role(org_id, array['org_admin', 'reviewer']));

create policy owner_or_reviewer_read on public.check_runs for select to authenticated
  using ((owner_user_id = auth.uid() and app.is_member(org_id)) or app.reviewer_can_see_check(id));
create policy owner_or_reviewer_read on public.check_findings for select to authenticated
  using (exists (select 1 from public.check_runs r where r.id = check_run_id and r.owner_user_id = auth.uid()) or app.reviewer_can_see_check(check_run_id));

create policy owner_read on public.submissions for select to authenticated
  using ((owner_user_id = auth.uid() and app.is_member(org_id)) or (status <> 'withdrawn' and app.is_cohort_reviewer(cohort_id)));
create policy owner_insert on public.submissions for insert to authenticated
  with check (owner_user_id = auth.uid() and app.is_member(org_id) and status = 'submitted');

create policy owner_or_reviewer_read on public.submission_assets for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id
                 and (s.owner_user_id = auth.uid() or (s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)))));
create policy owner_insert on public.submission_assets for insert to authenticated with check (shared_by = auth.uid());

create policy participants_read on public.feedback for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id
                 and (s.owner_user_id = auth.uid() or (s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)))));

create policy owner_all on public.publication_records for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy via_publication on public.result_snapshots for all to authenticated
  using (exists (select 1 from public.publication_records p where p.id = publication_id and p.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.publication_records p where p.id = publication_id and p.org_id = result_snapshots.org_id and p.owner_user_id = auth.uid()));

grant select, insert, update, delete on public.plans, public.publication_records, public.result_snapshots to authenticated;
grant select, insert on public.plan_versions, public.submissions, public.submission_assets to authenticated;
grant select, insert, update, delete on public.check_rules to authenticated;
grant select on public.check_runs, public.check_findings, public.feedback to authenticated;

insert into app.applied_migrations (version, name) values ('20261005000003', '20261005000003_plans_reviews.sql');

-- ==== 20261005000004_providers_cost_jobs.sql ====

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

insert into app.applied_migrations (version, name) values ('20261005000004', '20261005000004_providers_cost_jobs.sql');

-- ==== 20261005000005_m1_discovery.sql ====

-- M1 additions: author scale on notes, reference titles, analysis lookups.

alter table public.notes
  add column author_followers jsonb, -- MetricValue; ranges like 4w+ kept as bounds
  add column observed_at timestamptz;

alter table public.reference_items
  add column title text check (length(title) <= 200);

create index analyses_target on public.analyses (org_id, owner_user_id, target_type, target_id, created_at desc);
create index app_jobs_owner_kind_day on public.app_jobs (org_id, owner_user_id, kind, created_at);

-- Students request analyses through jobs; the worker writes results.
-- Owners may delete their own analyses (spec 10.1 deletion).
create policy owner_delete on public.analyses for delete to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));
grant delete on public.analyses to authenticated;

-- Personal expression entries can be edited/removed by their owner.
create policy own_update on public.expressions for update to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id))
  with check (owner_user_id = auth.uid() and review_status = 'draft');
create policy own_delete on public.expressions for delete to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));

-- Transcripts are per reference (owner-only). Cross-user reuse of a paid result
-- is deferred to P1 (needs an org-shared cache with its own permission checks).
drop index public.transcript_runs_one_success;
create unique index transcript_runs_one_success_per_reference on public.transcript_runs (reference_id) where status = 'succeeded';

insert into app.applied_migrations (version, name) values ('20261005000005', '20261005000005_m1_discovery.sql');

-- ==== 20261005000006_admin_phase1.sql ====

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

insert into app.applied_migrations (version, name) values ('20261005000006', '20261005000006_admin_phase1.sql');

-- ==== 20261005000007_m2_plans_checks.sql ====

-- M2: mutable working draft on plans (autosave), rule suggestions, reviewer helpers.

-- Autosave writes a mutable working copy guarded by plans.revision. Immutable
-- plan_versions are created only by explicit "save version", AI proposals and
-- applied proposals; checks and submissions always reference versions.
alter table public.plans
  add column draft_json jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_json) = 'object'),
  add column draft_updated_at timestamptz;

alter table public.check_rules
  add column suggestion_zh text check (length(suggestion_zh) <= 100),
  add column created_by uuid;

-- Org rule cap (spec F09: 1000 active rules per org).
create or replace function app.enforce_rule_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.org_id is not null and new.status = 'active'
     and (select count(*) from public.check_rules where org_id = new.org_id and status = 'active' and id <> new.id) >= 1000 then
    raise exception 'RULE_CAP: 1000 active rules per organization' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger check_rules_cap before insert or update of status on public.check_rules for each row execute function app.enforce_rule_cap();

-- Reviewers see the submitting student's email only through an active submission in their cohort.
create or replace function app.submission_author(p_submission uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from public.submissions s join auth.users u on u.id = s.owner_user_id
  where s.id = p_submission and s.status <> 'withdrawn' and (s.owner_user_id = auth.uid() or app.is_cohort_reviewer(s.cohort_id))
$$;
revoke all on function app.submission_author(uuid) from public;
grant execute on function app.submission_author(uuid) to authenticated;

-- Reviewers mark a submission in_review when they open it (no other status writes).
create or replace function app.start_review(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.submissions set status = 'in_review'
   where id = p_submission and status = 'submitted' and app.is_cohort_reviewer(cohort_id);
end $$;
revoke all on function app.start_review(uuid) from public;
grant execute on function app.start_review(uuid) to authenticated;

-- Plans: deleting a plan is a soft delete; versions stay immutable.
create index plan_versions_plan on public.plan_versions (plan_id, version desc);
create index check_runs_version on public.check_runs (plan_version_id, created_at desc);
create index submissions_cohort on public.submissions (cohort_id, submitted_at desc) where status <> 'withdrawn';

insert into app.applied_migrations (version, name) values ('20261005000007', '20261005000007_m2_plans_checks.sql');

-- ==== 20261005000008_m3_ops.sql ====

-- M3: results metadata, private assets for evidence/PDF, library share requests,
-- provider permission evidence, deletion processing.

-- Results (F11): student-entered classification for own comparisons.
alter table public.publication_records
  add column title text check (length(title) <= 200),
  add column topic text,
  add column format text,
  add column updated_at timestamptz not null default now();
create index publication_records_owner on public.publication_records (org_id, owner_user_id, published_at desc);
create index result_snapshots_pub on public.result_snapshots (publication_id, observed_at desc);

-- Assets: PDF allowed for permission evidence; purpose recorded; storage backend abstracted.
alter table public.assets drop constraint assets_mime_check;
alter table public.assets add constraint assets_mime_check check (mime in ('image/jpeg', 'image/png', 'image/webp', 'text/csv', 'application/pdf'));
alter table public.assets
  add column purpose text not null default 'reference_image' check (purpose in ('reference_image', 'submission_attachment', 'permission_evidence', 'result_attachment')),
  add column original_name text check (length(original_name) <= 200),
  add column width integer,
  add column height integer,
  add column metadata_stripped boolean not null default false;
-- Evidence must be a PDF or image uploaded by an admin of the same org.
alter table public.provider_permissions
  add constraint provider_permissions_evidence_fk foreign key (org_id, evidence_private_file_id) references public.assets(org_id, id);

-- Library sharing (F05): explicit request with consent; snapshot created only by staff review.
alter table public.reference_items
  add column share_requested_at timestamptz,
  add column share_consent_id uuid;
create index reference_items_share_requests on public.reference_items (org_id) where share_requested_at is not null and deleted_at is null;

-- Staff need to read the request queue (title/memo/source only) without owner RLS: SECURITY DEFINER view function.
create or replace function app.share_requests(p_org uuid)
returns table (reference_id uuid, owner_user_id uuid, owner_email text, title text, source_type text, manual_url text, note_title text,
               user_memo text, license_assertion text, revision integer, requested_at timestamptz, consent_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.id, r.owner_user_id, u.email, r.title, r.source_type, r.manual_url, n.title, r.user_memo, r.license_assertion, r.revision, r.share_requested_at, r.share_consent_id
  from public.reference_items r
  join auth.users u on u.id = r.owner_user_id
  left join public.notes n on n.id = r.note_id
  join public.consent_records c on c.id = r.share_consent_id and c.withdrawn_at is null
  where r.org_id = p_org and r.share_requested_at is not null and r.deleted_at is null
    and app.has_role(p_org, array['reviewer', 'org_admin'])
    and not exists (select 1 from public.reference_publications p where p.source_reference_id = r.id and p.source_revision = r.revision and p.status = 'published')
  order by r.share_requested_at
$$;
revoke all on function app.share_requests(uuid) from public;
grant execute on function app.share_requests(uuid) to authenticated;

-- Publishing creates the immutable snapshot from the CURRENT source row (server-side, not client-supplied content).
create or replace function app.publish_reference(p_reference uuid, p_expected_revision integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_id uuid;
  v_snapshot jsonb;
begin
  select ri.*, n.title as note_title, n.canonical_url, n.data_mode as note_mode into r
  from public.reference_items ri left join public.notes n on n.id = ri.note_id
  where ri.id = p_reference for update of ri;
  if not found or not app.has_role(r.org_id, array['reviewer', 'org_admin']) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.deleted_at is not null or r.share_requested_at is null then raise exception 'SHARE_NOT_REQUESTED' using errcode = 'P0001'; end if;
  if r.revision <> p_expected_revision then raise exception 'STALE_REVISION' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.consent_records c where c.id = r.share_consent_id and c.user_id = r.owner_user_id and c.withdrawn_at is null and c.purpose = 'reference_sharing') then
    raise exception 'CONSENT_MISSING' using errcode = 'P0001';
  end if;
  -- Third-party content shared as reference only: keep links/titles and the student's own notes, never full copies of others' text.
  v_snapshot := jsonb_build_object(
    'title', coalesce(r.title, r.note_title), 'sourceType', r.source_type, 'url', coalesce(r.manual_url, r.canonical_url),
    'memo', r.user_memo, 'tags', to_jsonb(r.tags), 'licenseAssertion', r.license_assertion, 'dataMode', coalesce(r.note_mode, 'mock'),
    'userText', case when r.license_assertion in ('own_content', 'licensed') then r.user_text else null end);
  insert into public.reference_publications (org_id, source_reference_id, source_revision, source_owner_user_id, snapshot_json, content_hash, consent_record_id, reviewed_by)
  values (r.org_id, r.id, r.revision, r.owner_user_id, v_snapshot, encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex'), r.share_consent_id, auth.uid())
  returning id into v_id;
  perform app.audit(r.org_id, 'library.published', 'reference_publication', v_id, jsonb_build_object('source_revision', r.revision));
  return v_id;
end $$;

-- Owner revokes sharing: consent withdrawn, every publication of the source hidden immediately.
create or replace function app.revoke_reference_sharing(p_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reference_items;
begin
  select * into r from public.reference_items where id = p_reference and owner_user_id = auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.consent_records set withdrawn_at = now() where id = r.share_consent_id and withdrawn_at is null;
  update public.reference_items set share_requested_at = null, share_consent_id = null where id = r.id;
  update public.reference_publications set status = 'revoked', status_reason = 'owner_revoked' where source_reference_id = r.id and status = 'published';
  perform app.audit(r.org_id, 'library.sharing_revoked', 'reference', r.id, '{}'::jsonb);
end $$;

create or replace function app.unpublish_reference(p_publication uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  update public.reference_publications set status = 'revoked', status_reason = left(coalesce(p_reason, 'staff_unpublished'), 200)
   where id = p_publication and status = 'published' and app.has_role(org_id, array['reviewer', 'org_admin'])
   returning org_id into v_org;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app.audit(v_org, 'library.unpublished', 'reference_publication', p_publication, '{}'::jsonb);
end $$;

-- Deleting or trashing the source hides publications too (spec F05).
create or replace function app.hide_publications_on_source_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE') or (new.deleted_at is not null and old.deleted_at is null) then
    update public.reference_publications set status = 'revoked', status_reason = 'source_deleted'
     where source_reference_id = old.id and status = 'published';
  end if;
  return coalesce(new, old);
end $$;
create trigger reference_items_hide_pubs after update of deleted_at or delete on public.reference_items
  for each row execute function app.hide_publications_on_source_delete();
-- The FK from publications to reference_items must allow hard deletion of the source later.
alter table public.reference_publications drop constraint reference_publications_org_id_source_reference_id_fkey;

revoke all on function app.publish_reference(uuid, integer), app.revoke_reference_sharing(uuid), app.unpublish_reference(uuid, text) from public;
grant execute on function app.publish_reference(uuid, integer), app.revoke_reference_sharing(uuid), app.unpublish_reference(uuid, text) to authenticated;

-- Admin usage: aggregate without student text.
create or replace function app.usage_summary(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (status text, provider text, endpoint text, currency text, calls bigint, reserved numeric, actual numeric)
language sql stable security definer set search_path = '' as $$
  select l.status, l.provider, l.endpoint, l.currency, count(*), sum(l.reserved_amount), sum(coalesce(l.actual_amount, 0))
  from public.usage_ledger l
  where l.org_id = p_org and l.occurred_at >= p_from and l.occurred_at < p_to and app.has_role(p_org, array['org_admin'])
  group by 1, 2, 3, 4 order by 1, 2, 3
$$;
revoke all on function app.usage_summary(uuid, timestamptz, timestamptz) from public;
grant execute on function app.usage_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Admin reconcile of unknown outcomes requires evidence and an org admin.
create or replace function app.reconcile_usage(p_ledger uuid, p_outcome text, p_actual numeric, p_evidence text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.usage_ledger where id = p_ledger and status = 'unknown_outcome';
  if v_org is null or not app.has_role(v_org, array['org_admin']) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if coalesce(length(trim(p_evidence)), 0) < 5 then raise exception 'EVIDENCE_REQUIRED' using errcode = 'P0001'; end if;
  perform app.settle_usage(p_ledger, p_outcome, p_actual);
  perform app.audit(v_org, 'usage.reconciled', 'usage_ledger', p_ledger, jsonb_build_object('outcome', p_outcome, 'actual', p_actual, 'evidence', left(p_evidence, 200)));
end $$;
revoke all on function app.reconcile_usage(uuid, text, numeric, text) from public;
grant execute on function app.reconcile_usage(uuid, text, numeric, text) to authenticated;
grant execute on function app.settle_usage(uuid, text, numeric) to postgres;

-- Job cancel: owner or org admin, only while queued/waiting (spec: cost already incurred is not guaranteed refundable).
create or replace function app.cancel_job(p_job uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update public.app_jobs set state = 'cancelled', error_code = 'cancelled_by_user'
   where id = p_job and state in ('queued', 'waiting_external')
     and (owner_user_id = auth.uid() or app.has_role(org_id, array['org_admin']))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function app.cancel_job(uuid) from public;
grant execute on function app.cancel_job(uuid) to authenticated;

-- Deletion requests: access blocking flag on membership-level data is the request itself; worker processes.
alter table public.deletion_requests add column job_id uuid, add column summary jsonb;

insert into app.applied_migrations (version, name) values ('20261005000008', '20261005000008_m3_ops.sql');

-- ==== 20261005000009_assets_access.sql ====

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

insert into app.applied_migrations (version, name) values ('20261005000009', '20261005000009_assets_access.sql');

-- ==== 20261005000010_ops_audit.sql ====

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

insert into app.applied_migrations (version, name) values ('20261005000010', '20261005000010_ops_audit.sql');

-- ==== 20261005000011_reports_taxonomy.sql ====

-- M4: error/rights reports (spec 11) and reference account helpers (F14).

create table public.result_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reporter_user_id uuid not null,
  target_type text not null check (target_type in ('analysis', 'check_finding', 'library_item', 'transcript', 'note')),
  target_id uuid not null,
  finding_index integer,
  rule_key text check (length(rule_key) <= 120), -- snapshot of the reported finding's rule (reviewers cannot read private findings)
  reason text not null check (reason in ('incorrect', 'false_positive', 'missed_issue', 'rights_issue', 'source_removed', 'other')),
  note text check (length(note) <= 200), -- short reason only; never the student's full text
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, reporter_user_id) references public.memberships(org_id, user_id) on delete cascade
);
alter table public.result_reports enable row level security;
create policy own_insert on public.result_reports for insert to authenticated
  with check (reporter_user_id = auth.uid() and app.is_member(org_id) and status = 'open');
create policy own_or_staff_read on public.result_reports for select to authenticated
  using (reporter_user_id = auth.uid() or app.has_role(org_id, array['reviewer', 'org_admin']));
create policy staff_update on public.result_reports for update to authenticated
  using (app.has_role(org_id, array['reviewer', 'org_admin'])) with check (app.has_role(org_id, array['reviewer', 'org_admin']));
grant select, insert, update on public.result_reports to authenticated;

-- A rights/source report on a library item hides it immediately pending staff review (spec 11).
create or replace function app.report_library_item(p_publication uuid, p_reason text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select org_id into v_org from public.reference_publications where id = p_publication and status = 'published';
  if v_org is null or not app.is_member(v_org) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  insert into public.result_reports (org_id, reporter_user_id, target_type, target_id, reason, note)
    values (v_org, auth.uid(), 'library_item', p_publication, p_reason, left(p_note, 200)) returning id into v_id;
  if p_reason in ('rights_issue', 'source_removed') then
    update public.reference_publications set status = 'revoked', status_reason = 'report:' || p_reason where id = p_publication;
    perform app.audit(v_org, 'library.hidden_by_report', 'reference_publication', p_publication, jsonb_build_object('reason', p_reason));
  end if;
  return v_id;
end $$;
revoke all on function app.report_library_item(uuid, text, text) from public;
grant execute on function app.report_library_item(uuid, text, text) to authenticated;

-- Org taxonomy terms: deactivate instead of delete (spec F03).
create policy admin_no_delete on public.taxonomy_terms as restrictive for delete to authenticated using (false);

create index reference_accounts_owner on public.reference_accounts (org_id, owner_user_id, saved_at desc);
create index notes_author on public.notes (org_id, data_mode, author_ref);

insert into app.applied_migrations (version, name) values ('20261005000011', '20261005000011_reports_taxonomy.sql');

-- ==== 20261005000012_org_leave.sql ====

-- Voluntary org leave (F01): access ends immediately, data is deleted by the
-- user_deletion job, the membership row stays (status 'left') for audit and FKs.

alter table public.memberships drop constraint memberships_status_check;
alter table public.memberships add constraint memberships_status_check check (status in ('active', 'suspended', 'left'));
alter table public.memberships add column left_at timestamptz;

alter table public.deletion_requests drop constraint deletion_requests_scope_check;
alter table public.deletion_requests add constraint deletion_requests_scope_check
  check (scope in ('all_my_data', 'account', 'reference', 'plan', 'transcript', 'leave_org'));

create or replace function app.leave_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not app.is_member(p_org) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  -- The last active org_admin is protected by app.guard_last_admin (raises LAST_ADMIN).
  update public.memberships set status = 'left', left_at = now() where org_id = p_org and user_id = v_uid and status = 'active';
  update public.cohort_members set status = 'removed' where org_id = p_org and user_id = v_uid and status = 'active';
  perform app.audit(p_org, 'membership.left', 'membership', null, '{}'::jsonb);
end $$;
revoke all on function app.leave_org(uuid) from public;
grant execute on function app.leave_org(uuid) to authenticated;

-- Re-invited former members come back as active; suspended members stay suspended (admin decision).
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
    on conflict (org_id, user_id) do update set status = 'active', role = excluded.role, left_at = null
      where public.memberships.status = 'left';
  if v_inv.cohort_id is not null and v_inv.role in ('student', 'reviewer') then
    insert into public.cohort_members (org_id, cohort_id, user_id, role)
      values (v_inv.org_id, v_inv.cohort_id, v_uid, v_inv.role)
      on conflict (cohort_id, user_id, role) do update set status = 'active';
  end if;
  update public.invitations set used_at = now(), used_by = v_uid where id = v_inv.id;
  perform app.audit(v_inv.org_id, 'invitation.redeemed', 'invitation', v_inv.id, '{}'::jsonb);
  return v_inv.org_id;
end $$;
revoke all on function app.redeem_invitation(text) from public;
grant execute on function app.redeem_invitation(text) to authenticated;

insert into app.applied_migrations (version, name) values ('20261005000012', '20261005000012_org_leave.sql');

-- ==== 20261005000013_production_base.sql ====

-- Production readiness: base data every environment needs, and admin helpers for
-- one-time password links (Supabase Auth). Demo users/orgs stay in seed.sql only.

-- Global taxonomy (spec F03). Provider category mapping is a starting point, not 1:1.
insert into public.taxonomy_terms (org_id, kind, slug, label_ko, label_zh, mapping_json) values
  (null, 'topic', 'beauty', '뷰티', '美妆', '{"redfox_rank_category": ["化妆美容", "个人护理"]}'),
  (null, 'topic', 'daily-life', '일상', '日常', '{"redfox_rank_category": ["日常生活"]}'),
  (null, 'topic', 'parenting', '육아', '育儿', '{"redfox_rank_category": ["亲子育儿"]}'),
  (null, 'topic', 'food-places', '맛집·카페', '探店', '{"redfox_rank_category": ["美味佳肴"], "note": "美味佳肴 includes cooking; classify restaurants separately"}'),
  (null, 'topic', 'travel-outing', '여행·외출', '出行', '{"redfox_rank_category": ["旅行度假"]}'),
  (null, 'topic', 'fashion', '패션', '穿搭', '{"redfox_rank_category": ["时尚穿搭", "潮流鞋包"]}'),
  (null, 'format', 'vlog', '브이로그', 'vlog', '{}'),
  (null, 'format', 'review', '리뷰', '测评', '{}'),
  (null, 'format', 'comparison', '비교', '对比', '{}'),
  (null, 'format', 'routine', '루틴', '日常流程', '{}'),
  (null, 'format', 'how-to', '방법 소개', '教程', '{}'),
  (null, 'format', 'information-list', '정보 정리', '合集', '{}'),
  (null, 'format', 'story', '이야기', '故事', '{}'),
  (null, 'format', 'photo-diary', '사진 일기', '图文日记', '{}')
on conflict do nothing;

-- True when the user is active in any org other than p_org (caller must be p_org's admin).
create or replace function app.member_in_other_org(p_org uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['org_admin']) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return exists (select 1 from public.memberships m where m.user_id = p_user and m.org_id <> p_org and m.status = 'active');
end $$;

-- Audit entry for an issued password link (the link itself is never stored).
create or replace function app.log_password_link(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['org_admin']) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app.audit(p_org, 'member.password_link_issued', 'user', p_user, '{}'::jsonb);
end $$;

revoke all on function app.member_in_other_org(uuid, uuid), app.log_password_link(uuid, uuid) from public;
grant execute on function app.member_in_other_org(uuid, uuid), app.log_password_link(uuid, uuid) to authenticated;

insert into app.applied_migrations (version, name) values ('20261005000013', '20261005000013_production_base.sql');
