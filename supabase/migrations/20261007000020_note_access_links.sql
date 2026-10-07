-- Public post sharing credentials are separate from canonical identity and provenance.
create table public.note_access_links (
  note_id uuid primary key references public.notes(id) on delete cascade,
  org_id uuid not null,
  access_url text not null check(length(access_url) <= 4000),
  expires_at timestamptz not null,
  foreign key(org_id,note_id) references public.notes(org_id,id) on delete cascade
);
alter table public.note_access_links enable row level security;
revoke all on public.note_access_links from public, anon, authenticated;
grant all on public.note_access_links to service_role;
create function app.has_note_access_link(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from note_access_links l join notes n on n.id=l.note_id
    where l.note_id=p_id and l.expires_at>now() and app.is_member(l.org_id)
      and (n.expires_at is null or n.expires_at>now()));
$$;
revoke all on function app.has_note_access_link(uuid) from public;
grant execute on function app.has_note_access_link(uuid) to authenticated, service_role;
