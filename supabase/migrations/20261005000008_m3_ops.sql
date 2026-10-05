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
