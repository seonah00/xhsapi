-- Admin-managed shared dictionary imports. Raw source data stays in an admin-only
-- batch table; published entries continue to live in keywords / expressions.

alter table public.keywords
  add column shared_dictionary_key text,
  add column shared_dictionary_meta jsonb;
alter table public.expressions
  add column shared_dictionary_key text,
  add column shared_dictionary_meta jsonb;

alter table public.keywords add constraint keywords_shared_dictionary_meta_object
  check (shared_dictionary_meta is null or jsonb_typeof(shared_dictionary_meta) = 'object');
alter table public.expressions add constraint expressions_shared_dictionary_meta_object
  check (shared_dictionary_meta is null or jsonb_typeof(shared_dictionary_meta) = 'object');
alter table public.keywords
  drop constraint keywords_org_id_canonical_text_kind_provenance_data_mode_key;
create unique index keywords_legacy_identity_unique
  on public.keywords (org_id, canonical_text, kind, provenance, data_mode)
  where shared_dictionary_key is null;
create unique index keywords_shared_dictionary_key_unique
  on public.keywords (org_id, data_mode, shared_dictionary_key) where shared_dictionary_key is not null;
create unique index expressions_shared_dictionary_key_unique
  on public.expressions (org_id, data_mode, shared_dictionary_key) where shared_dictionary_key is not null;

create table public.dictionary_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (length(label) between 1 and 120),
  status text not null default 'staged' check (status in ('staged', 'reviewed', 'published')),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  tag_count integer not null check (tag_count >= 0),
  expression_count integer not null check (expression_count >= 0),
  entry_count integer not null check (entry_count = tag_count + expression_count and entry_count <= 10000),
  data_mode text not null check (data_mode in ('mock', 'live')),
  staged_by uuid not null,
  reviewed_by uuid,
  published_by uuid,
  revision integer not null default 1 check (revision > 0),
  catalog_revision text check (catalog_revision is null or catalog_revision ~ '^[0-9a-f]{64}$'),
  publish_result jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  -- Actor UUIDs are immutable audit history, not references to active membership.
  -- Authorization is checked by RLS/core at each transition.
  unique (org_id, id),
  check (octet_length(raw_payload::text) <= 2097152),
  check ((status = 'staged' and catalog_revision is null and reviewed_by is null and reviewed_at is null and published_by is null and published_at is null)
      or (status = 'reviewed' and catalog_revision is not null and reviewed_by is not null and reviewed_at is not null and published_by is null and published_at is null)
      or (status = 'published' and catalog_revision is not null and reviewed_by is not null and reviewed_at is not null and published_by is not null and published_at is not null))
);
create index dictionary_import_batches_org_created on public.dictionary_import_batches (org_id, created_at desc);

-- A stable, server-computed revision covers only the published catalog's
-- allowlisted metadata and current status. Raw import sources never enter it.
create or replace function app.dictionary_catalog_revision(p_org uuid, p_mode text) returns text
language sql volatile set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by c.entry_type, c.dictionary_key), '[]'::jsonb)::text, 'UTF8')), 'hex')
    from (
      select 'tag'::text as entry_type, shared_dictionary_key as dictionary_key,
             shared_dictionary_meta as metadata, review_status as current_status
        from public.keywords
       where org_id = p_org and data_mode = p_mode and shared_dictionary_key is not null
      union all
      select 'expression'::text as entry_type, shared_dictionary_key as dictionary_key,
             shared_dictionary_meta as metadata, review_status as current_status
        from public.expressions
       where org_id = p_org and data_mode = p_mode and owner_user_id is null and shared_dictionary_key is not null
    ) c
$$;

-- Payloads and previews are immutable after staging. Review captures the exact
-- org/mode catalog revision while holding the same lock used by publication.
create or replace function app.guard_dictionary_import_batch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- RLS decides who may erase private import sources; cascades must also work.
    return old;
  end if;
  if new.org_id is distinct from old.org_id
     or new.label is distinct from old.label
     or new.raw_payload is distinct from old.raw_payload
     or new.normalized_payload is distinct from old.normalized_payload
     or new.tag_count is distinct from old.tag_count
     or new.expression_count is distinct from old.expression_count
     or new.entry_count is distinct from old.entry_count
     or new.data_mode is distinct from old.data_mode
     or new.staged_by is distinct from old.staged_by
     or new.created_at is distinct from old.created_at then
    raise exception 'DICTIONARY_IMPORT_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'DICTIONARY_IMPORT_STALE' using errcode = 'P0001';
  end if;
  if not ((old.status = 'staged' and new.status = 'reviewed')
       or (old.status = 'reviewed' and new.status = 'published')) then
    raise exception 'DICTIONARY_IMPORT_FLOW' using errcode = 'P0001';
  end if;
  if old.status = 'staged' then
    perform pg_advisory_xact_lock(hashtextextended('shared-dictionary:' || old.org_id::text || ':' || old.data_mode, 0));
    new.catalog_revision := app.dictionary_catalog_revision(old.org_id, old.data_mode);
  elsif new.catalog_revision is distinct from old.catalog_revision then
    raise exception 'DICTIONARY_IMPORT_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger dictionary_import_batches_guard
  before update or delete on public.dictionary_import_batches
  for each row execute function app.guard_dictionary_import_batch();

alter table public.dictionary_import_batches enable row level security;
create policy dictionary_import_admin_all on public.dictionary_import_batches for all to authenticated
  using (app.has_role(org_id, array['org_admin']))
  with check (app.has_role(org_id, array['org_admin']));
grant select, insert, update, delete on public.dictionary_import_batches to authenticated;

-- Students see published keywords only. Reviewers/admins retain the existing
-- curation visibility, while only org admins receive keyword mutation rights.
drop policy member_read on public.keywords;
create policy keywords_member_read on public.keywords for select to authenticated
  using (app.is_member(org_id) and (review_status = 'published' or app.has_role(org_id, array['reviewer', 'org_admin'])));
create policy keywords_admin_write on public.keywords for all to authenticated
  using (app.has_role(org_id, array['org_admin']))
  with check (app.has_role(org_id, array['org_admin']));
grant insert, update, delete on public.keywords to authenticated;

-- Imported shared expressions are admin-managed. Existing personal expression
-- writes and staff curation remain governed by the earlier policies.
create policy expressions_import_admin_write on public.expressions for all to authenticated
  using (owner_user_id is null and shared_dictionary_key is not null and app.has_role(org_id, array['org_admin']))
  with check (owner_user_id is null and shared_dictionary_key is not null and app.has_role(org_id, array['org_admin']));
create policy expressions_import_insert_restrictive on public.expressions as restrictive for insert to authenticated
  with check (shared_dictionary_key is null or app.has_role(org_id, array['org_admin']));
create policy expressions_import_update_restrictive on public.expressions as restrictive for update to authenticated
  using (shared_dictionary_key is null or app.has_role(org_id, array['org_admin']))
  with check (shared_dictionary_key is null or app.has_role(org_id, array['org_admin']));
create policy expressions_import_delete_restrictive on public.expressions as restrictive for delete to authenticated
  using (shared_dictionary_key is null or app.has_role(org_id, array['org_admin']));

-- A single statement locks the reviewed batch, upserts only rows carrying the
-- matching private dictionary key, and advances the batch to published.
create or replace function app.publish_dictionary_import(p_batch uuid, p_org uuid, p_actor uuid)
returns table (
  batch_id uuid,
  tags integer,
  expressions integer,
  total integer,
  created_count integer,
  updated_count integer,
  unchanged_count integer
)
language plpgsql set search_path = '' as $$
declare
  v_batch public.dictionary_import_batches;
  v_entry jsonb;
  v_meta jsonb;
  v_key text;
  v_type text;
  v_id uuid;
  v_existing_meta jsonb;
  v_existing_status text;
  v_existing_provenance text;
  v_current_revision text;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
begin
  if auth.uid() is distinct from p_actor or not app.has_role(p_org, array['org_admin']) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_batch from public.dictionary_import_batches
   where id = p_batch and org_id = p_org for update;
  if not found then raise exception 'DICTIONARY_IMPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_batch.status <> 'reviewed' then raise exception 'DICTIONARY_IMPORT_NOT_REVIEWED' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtextextended('shared-dictionary:' || p_org::text || ':' || v_batch.data_mode, 0));
  v_current_revision := app.dictionary_catalog_revision(p_org, v_batch.data_mode);
  if v_current_revision is distinct from v_batch.catalog_revision then
    raise exception 'DICTIONARY_IMPORT_CATALOG_STALE' using errcode = 'P0001';
  end if;

  for v_entry in select value from jsonb_array_elements(v_batch.normalized_payload->'entries') loop
    v_key := v_entry->>'canonicalKey';
    v_type := v_entry->>'entryType';
    v_meta := v_entry - 'canonicalKey' - 'entryType';
    if v_type = 'tag' then
      select id, shared_dictionary_meta, review_status, provenance
        into v_id, v_existing_meta, v_existing_status, v_existing_provenance
        from public.keywords
       where org_id = p_org and data_mode = v_batch.data_mode and shared_dictionary_key = v_key for update;
      if found then
        if v_existing_meta = v_meta and v_existing_status = 'published' and v_existing_provenance = 'editorial_seed' then
          v_unchanged := v_unchanged + 1;
        else
          update public.keywords set
            canonical_text = lower(trim(both '#' from v_entry->>'term')),
            raw_text = v_entry->>'term', meaning_ko = v_entry->>'meaning',
            topics = array(select jsonb_array_elements_text(v_entry->'categories')),
            provenance = 'editorial_seed', data_mode = v_batch.data_mode,
            review_status = 'published', shared_dictionary_meta = v_meta
          where id = v_id;
          v_updated := v_updated + 1;
        end if;
      else
        insert into public.keywords
          (org_id, canonical_text, raw_text, kind, provenance, meaning_ko, topics, review_status, data_mode, shared_dictionary_key, shared_dictionary_meta)
        values
          (p_org, lower(trim(both '#' from v_entry->>'term')), v_entry->>'term', 'hashtag', 'editorial_seed',
           v_entry->>'meaning', array(select jsonb_array_elements_text(v_entry->'categories')), 'published', v_batch.data_mode,
           v_key, v_meta);
        v_created := v_created + 1;
      end if;
    elsif v_type = 'expression' then
      select id, shared_dictionary_meta, review_status, provenance
        into v_id, v_existing_meta, v_existing_status, v_existing_provenance
        from public.expressions
       where org_id = p_org and data_mode = v_batch.data_mode and shared_dictionary_key = v_key for update;
      if found then
        if v_existing_meta = v_meta and v_existing_status = 'published' and v_existing_provenance = 'editorial' then
          v_unchanged := v_unchanged + 1;
        else
          update public.expressions set
            expression = v_entry->>'term', explanations_json = jsonb_build_object('meaning', v_entry->>'meaning'),
            topics = array(select jsonb_array_elements_text(v_entry->'categories')),
            expression_type = case when nullif(v_entry->>'unknownTrendNote','') is null then 'basic' else 'trend_unverified' end,
            provenance = 'editorial', data_mode = v_batch.data_mode,
            review_status = 'published', version = version + 1, shared_dictionary_meta = v_meta
          where id = v_id;
          v_updated := v_updated + 1;
        end if;
      else
        insert into public.expressions
          (org_id, owner_user_id, expression, explanations_json, topics, expression_type, provenance, review_status,
           data_mode, shared_dictionary_key, shared_dictionary_meta)
        values
          (p_org, null, v_entry->>'term', jsonb_build_object('meaning', v_entry->>'meaning'),
           array(select jsonb_array_elements_text(v_entry->'categories')),
           case when nullif(v_entry->>'unknownTrendNote','') is null then 'basic' else 'trend_unverified' end,
           'editorial', 'published', v_batch.data_mode, v_key, v_meta);
        v_created := v_created + 1;
      end if;
    else
      raise exception 'DICTIONARY_ENTRY_TYPE' using errcode = 'P0001';
    end if;
  end loop;

  update public.dictionary_import_batches set
    status = 'published', published_by = p_actor, published_at = now(), revision = revision + 1,
    publish_result = jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged)
  where id = p_batch;

  return query select p_batch, v_batch.tag_count, v_batch.expression_count, v_batch.entry_count,
                      v_created, v_updated, v_unchanged;
end $$;
revoke all on function app.publish_dictionary_import(uuid, uuid, uuid) from public;
grant execute on function app.publish_dictionary_import(uuid, uuid, uuid) to authenticated;

-- Import audit contains only counts/status, never raw or preview content.
create or replace function app.audit_dictionary_import_batch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (org_id, actor_id, action, target_type, target_id, redacted_metadata)
  values (new.org_id, auth.uid(), 'dictionary_import.' || new.status, 'dictionary_import_batch', new.id,
          jsonb_build_object('tags', new.tag_count, 'expressions', new.expression_count, 'revision', new.revision));
  return new;
end $$;
create trigger dictionary_import_batches_audit
  after insert or update on public.dictionary_import_batches
  for each row execute function app.audit_dictionary_import_batch();
