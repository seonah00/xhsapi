alter table public.personal_dictionary
 add column note text not null default '' check(length(note)<=2000),
 add column folder text not null default '' check(length(folder)<=60),
 add column favorite boolean not null default false,
 add column usage text not null default '' check(length(usage)<=2000),
 add column examples jsonb not null default '[]' check(jsonb_typeof(examples)='array' and jsonb_array_length(examples)<=10),
 add column revision integer not null default 1 check(revision>0);
create table public.writing_temporary (
 org_id uuid not null references organizations(id) on delete cascade,
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 data_mode text not null check(data_mode in ('mock','live')),
 scope text not null check(scope='new' or scope ~ '^draft:[0-9a-f-]{36}$'),
 revision integer not null default 1 check(revision>0),
 content jsonb check(content is null or (jsonb_typeof(content)='object' and octet_length(content::text)<=100000)),
 updated_at timestamptz not null default now(),
 primary key(org_id,owner_user_id,data_mode,scope)
);
alter table writing_temporary enable row level security;
create policy writing_temporary_owner on writing_temporary for all to authenticated
 using(owner_user_id=(select auth.uid()) and app.is_member(org_id))
 with check(owner_user_id=(select auth.uid()) and app.is_member(org_id));
revoke all on writing_temporary from public,anon,authenticated;
grant select,insert,update on writing_temporary to authenticated;
grant all on writing_temporary to service_role;
