-- Provider cover images (RF02 search). Only the provider's own https image URL is kept: the app never
-- downloads or re-hosts third-party media. Display additionally requires an approved permission with
-- media display at read time, so revoking the permission hides covers immediately.
alter table public.notes add column if not exists cover_url text
  check (cover_url is null or (cover_url ~ '^https://[a-z0-9.-]+/' and length(cover_url) <= 2000));

create or replace function app.org_allows_media_display(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.provider_permissions p
    where p.org_id = p_org and p.provider = 'redfox' and p.status = 'approved' and p.allow_media_display
      and (p.expires_at is null or p.expires_at > now())
  ) and app.is_member(p_org);
$$;
revoke all on function app.org_allows_media_display(uuid) from public;
grant execute on function app.org_allows_media_display(uuid) to authenticated, service_role;
