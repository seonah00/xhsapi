alter table public.writing_drafts add column meaning_reviewed_for text not null default '' check(length(meaning_reviewed_for)<=40000);
alter table public.writing_drafts add column learning_notes text not null default '' check(length(learning_notes)<=12000);

create table public.case_guides (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations(id),
 data_mode text not null check(data_mode in ('mock','live')),content jsonb not null,
 status text not null default 'draft' check(status in ('draft','published')),revision integer not null default 1,
 created_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),reviewed_at timestamptz,
 updated_at timestamptz not null default now(),check(status<>'published' or (reviewed_by is not null and reviewed_at is not null))
);
alter table public.case_guides enable row level security;
create policy guide_read on public.case_guides for select to authenticated using(app.is_member(org_id) and (status='published' or app.has_role(org_id,array['org_admin'])));
create policy guide_create on public.case_guides for insert to authenticated with check(app.has_role(org_id,array['org_admin']) and created_by=auth.uid() and status='draft');
create policy guide_edit on public.case_guides for update to authenticated using(app.has_role(org_id,array['org_admin'])) with check(app.has_role(org_id,array['org_admin']) and (status='draft' or reviewed_by=auth.uid()));
create function app.invalidate_guide_review() returns trigger language plpgsql set search_path='' as $$begin
 if new.content is distinct from old.content then new.status:='draft';new.reviewed_by:=null;new.reviewed_at:=null;end if;return new;
end$$;
create trigger invalidate_case_review before update on public.case_guides for each row execute function app.invalidate_guide_review();
revoke all on public.case_guides from public,anon,authenticated;
grant select,insert,update on public.case_guides to authenticated;
grant all on public.case_guides to service_role;

create table public.writing_reviews (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,owner_user_id uuid not null,
 data_mode text not null check(data_mode in ('mock','live')),cohort_id uuid not null,
 draft_id uuid not null,revision integer not null,snapshot jsonb not null default '{}',
 status text not null default 'submitted' check(status in ('submitted','withdrawn')),created_at timestamptz not null default now(),
 foreign key(org_id,owner_user_id) references public.memberships(org_id,user_id),
 foreign key(org_id,cohort_id) references public.cohorts(org_id,id),
 foreign key(draft_id,revision) references public.writing_versions(draft_id,revision)
);
create unique index writing_review_active on public.writing_reviews(draft_id,revision,cohort_id) where status='submitted';
create function app.prepare_writing_review() returns trigger language plpgsql security definer set search_path='' as $$declare s jsonb;begin
 if new.owner_user_id<>auth.uid() or not app.is_member(new.org_id) or new.status<>'submitted' or not exists(select 1 from public.cohort_members m join public.cohorts c on c.id=m.cohort_id where m.org_id=new.org_id and m.cohort_id=new.cohort_id and m.user_id=auth.uid() and m.role='student' and m.status='active' and c.status='active') then raise exception 'WRITING_REVIEW_FORBIDDEN';end if;
 select v.snapshot into s from public.writing_versions v join public.writing_drafts d on d.id=v.draft_id where v.draft_id=new.draft_id and v.revision=new.revision and d.owner_user_id=auth.uid() and d.org_id=new.org_id and d.data_mode=new.data_mode and d.archived_at is null;
 if s is null then raise exception 'WRITING_REVIEW_NOT_FOUND';end if;
 new.snapshot:=jsonb_build_object('title',s->'title','cover',s->'cover','body',s->'body','meaningKo',s->'meaningKo','tags',s->'tags');return new;
end$$;
create trigger prepare_writing_review before insert on public.writing_reviews for each row execute function app.prepare_writing_review();
alter table public.writing_reviews enable row level security;
create policy writing_review_read on public.writing_reviews for select to authenticated using(app.is_member(org_id) and (owner_user_id=auth.uid() or (status='submitted' and app.is_cohort_reviewer(cohort_id))));
create policy writing_review_insert on public.writing_reviews for insert to authenticated with check(app.is_member(org_id) and owner_user_id=auth.uid());
revoke all on public.writing_reviews from public,anon,authenticated;
grant select,insert on public.writing_reviews to authenticated;
grant all on public.writing_reviews to service_role;
create function app.withdraw_writing_review(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update public.writing_reviews set status='withdrawn' where id=p_id and owner_user_id=auth.uid() and app.is_member(org_id);
 if not found then raise exception 'NOT_FOUND';end if;
end$$;
revoke all on function app.withdraw_writing_review(uuid) from public,anon;
grant execute on function app.withdraw_writing_review(uuid) to authenticated;
create table public.writing_feedback (
 id uuid primary key default gen_random_uuid(),review_id uuid not null references public.writing_reviews(id),
 author_id uuid not null references auth.users(id),content text not null check(length(content) between 1 and 5000),created_at timestamptz not null default now()
);
alter table public.writing_feedback enable row level security;
create policy writing_feedback_read on public.writing_feedback for select to authenticated using(exists(select 1 from public.writing_reviews r where r.id=review_id));
create policy writing_feedback_insert on public.writing_feedback for insert to authenticated with check(author_id=auth.uid() and exists(select 1 from public.writing_reviews r where r.id=review_id and r.status='submitted' and app.is_cohort_reviewer(r.cohort_id)));
revoke all on public.writing_feedback from public,anon,authenticated;
grant select,insert on public.writing_feedback to authenticated;
grant all on public.writing_feedback to service_role;

alter table public.publication_records add column writing_draft_id uuid,add column writing_revision integer,
 add constraint publication_writing_version foreign key(writing_draft_id,writing_revision) references public.writing_versions(draft_id,revision),
 add constraint publication_writing_pair check((writing_draft_id is null)=(writing_revision is null));
create function app.check_publication_writing() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.writing_draft_id is not null and not exists(select 1 from public.writing_drafts d where d.id=new.writing_draft_id and d.org_id=new.org_id and d.owner_user_id=auth.uid() and new.owner_user_id=auth.uid()) then raise exception 'WRITING_PUBLICATION_FORBIDDEN';end if;return new;
end$$;
create trigger publication_writing_owner before insert or update on public.publication_records for each row execute function app.check_publication_writing();
create index writing_reviews_cohort on public.writing_reviews(org_id,cohort_id,status,created_at desc);
create index writing_feedback_review on public.writing_feedback(review_id,created_at);

revoke all on function app.prepare_writing_review(),app.check_publication_writing(),app.invalidate_guide_review() from public,anon,authenticated;
