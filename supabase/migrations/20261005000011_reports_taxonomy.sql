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
