-- ADR 0015: remove the separate evidence/permission prerequisite.
-- Keep historical records and their foreign keys; new enrichment needs no permission row.
alter table public.note_enrichments alter column permission_id drop not null;
create or replace function app.can_read_note_enrichment(p_org uuid,p_permission uuid,p_expires timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select app.is_member(p_org) and p_expires > now();
$$;
create or replace function app.org_allows_media_display(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select app.is_member(p_org);
$$;
