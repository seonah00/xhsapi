-- Observed page availability, separate from retained content and sharing credentials.
create table public.note_link_checks (
  note_id uuid primary key,
  org_id uuid not null,
  status text not null check (status in ('opened', 'not_found')),
  checked_at timestamptz not null,
  method text not null check (method = 'browser_rednote'),
  foreign key (org_id, note_id) references public.notes(org_id, id) on delete cascade
);
alter table public.note_link_checks enable row level security;
revoke all on public.note_link_checks from public, anon, authenticated;
grant select on public.note_link_checks to authenticated;
grant all on public.note_link_checks to service_role;
create policy via_note on public.note_link_checks for select to authenticated
  using (app.is_member(org_id) and exists (select 1 from public.notes n where n.id = note_id and n.org_id = note_link_checks.org_id));
