-- Retain provider relevance even when the literal query is absent from a title/tag.
create table public.note_search_matches (
  org_id uuid not null,
  note_id uuid not null,
  query_text text not null check(length(query_text) between 1 and 100),
  primary key(org_id,query_text,note_id),
  foreign key(org_id,note_id) references public.notes(org_id,id) on delete cascade
);
alter table public.note_search_matches enable row level security;
create policy member_read on public.note_search_matches for select to authenticated using(app.is_member(org_id));
grant select on public.note_search_matches to authenticated;
grant all on public.note_search_matches to service_role;
-- Recover exact result IDs from existing bounded collection jobs; do not include fallback items.
insert into public.note_search_matches(org_id,note_id,query_text)
select distinct j.org_id,n.id,trim(j.input_ref->>'query')
from public.app_jobs j
cross join lateral jsonb_array_elements_text(case when jsonb_typeof(j.result_ref->'noteIds')='array' then j.result_ref->'noteIds' else '[]'::jsonb end) ids(value)
join public.notes n on n.id::text=ids.value and n.org_id=j.org_id and n.data_mode=j.data_mode
where j.kind='provider_search' and length(trim(j.input_ref->>'query')) between 1 and 100 and not n.is_fallback
on conflict do nothing;
