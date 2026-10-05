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
