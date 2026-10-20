create table public.personal_dictionary (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade,
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 data_mode text not null check(data_mode in ('mock','live')),
 entry_type text not null check(entry_type in ('tag','expression')),
 term text not null check(length(term) between 1 and 120), canonical_term text not null,
 meaning text not null default '' check(length(meaning)<=1000), cautions jsonb not null default '[]',
 source_kind text not null check(source_kind in ('manual','shared','observed','interpret')),
 saved_at timestamptz not null default now(), deleted_at timestamptz,
 unique(org_id,owner_user_id,data_mode,entry_type,canonical_term)
);
create table public.writing_drafts (
 id uuid primary key,org_id uuid not null references organizations(id) on delete cascade,
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 data_mode text not null check(data_mode in ('mock','live')),
 title text not null default '' check(length(title)<=200), cover text not null default '' check(length(cover)<=100),
 body text not null default '' check(length(body)<=10000), meaning_ko text not null default '' check(length(meaning_ko)<=10000),
 tags jsonb not null default '[]', entries jsonb not null default '[]', revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.writing_versions (
 draft_id uuid not null references writing_drafts(id) on delete cascade,
 revision integer not null, snapshot jsonb not null, created_at timestamptz not null default now(),
 primary key(draft_id,revision)
);
alter table personal_dictionary enable row level security;
alter table writing_drafts enable row level security;
alter table writing_versions enable row level security;
create policy personal_dictionary_owner on personal_dictionary for all to authenticated
 using(owner_user_id=auth.uid() and app.is_member(org_id)) with check(owner_user_id=auth.uid() and app.is_member(org_id));
create policy writing_drafts_owner on writing_drafts for all to authenticated
 using(owner_user_id=auth.uid() and app.is_member(org_id)) with check(owner_user_id=auth.uid() and app.is_member(org_id));
create policy writing_versions_read on writing_versions for select to authenticated
 using(exists(select 1 from writing_drafts d where d.id=draft_id and d.owner_user_id=auth.uid() and app.is_member(d.org_id)));
create policy writing_versions_insert on writing_versions for insert to authenticated
 with check(exists(select 1 from writing_drafts d where d.id=draft_id and d.owner_user_id=auth.uid() and app.is_member(d.org_id)));
revoke all on personal_dictionary,writing_drafts,writing_versions from public,anon,authenticated;
grant select,insert,update on personal_dictionary,writing_drafts to authenticated;
grant select,insert on writing_versions to authenticated;
grant all on personal_dictionary,writing_drafts,writing_versions to service_role;
create index personal_dictionary_owner_list on personal_dictionary(org_id,owner_user_id,data_mode,saved_at desc);
create index writing_drafts_owner_list on writing_drafts(org_id,owner_user_id,data_mode,updated_at desc);
