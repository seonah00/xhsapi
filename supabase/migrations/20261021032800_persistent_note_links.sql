-- Sharing URLs are public post references, not login/API credentials. ADR0046.
-- NULL expiry follows the note lifetime (existing ON DELETE CASCADE remains).
alter table public.note_access_links alter column expires_at drop not null;
alter table public.note_access_links add column observed_at timestamptz not null default now();
-- Preserve original collection estimates rather than presenting migration as validation.
update public.note_access_links set observed_at=expires_at-interval '24 hours', expires_at=null
where expires_at is not null;
create or replace function app.has_note_access_link(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from note_access_links l join notes n on n.id=l.note_id
    where l.note_id=p_id and (l.expires_at is null or l.expires_at>now()) and app.is_member(l.org_id)
      and (n.expires_at is null or n.expires_at>now()));
$$;
revoke all on function app.has_note_access_link(uuid) from public;
grant execute on function app.has_note_access_link(uuid) to authenticated,service_role;
