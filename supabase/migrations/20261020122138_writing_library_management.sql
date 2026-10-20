alter table public.writing_drafts add column archived_at timestamptz;
alter table public.writing_versions add column restored_from integer check(restored_from>0);
create index writing_drafts_owner_archive on public.writing_drafts(org_id,owner_user_id,data_mode,archived_at,updated_at desc,id);
create index personal_dictionary_owner_paging on public.personal_dictionary(org_id,owner_user_id,data_mode,favorite desc,saved_at desc,id) where deleted_at is null;
