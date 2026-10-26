create table public.shooting_work (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,owner_user_id uuid not null,
 data_mode text not null check(data_mode in ('mock','live')),guide_id uuid not null references public.case_guides(id),guide_revision integer not null,
 guide_snapshot jsonb not null,revision integer not null default 1 check(revision>0),
 subject text not null default '' check(length(subject)<=200),checked jsonb not null default '[]' check(jsonb_typeof(checked)='array'),
 notes jsonb not null default '{}' check(jsonb_typeof(notes)='object'),memo text not null default '' check(length(memo)<=3000),
 imported_revision integer not null default 0,updated_at timestamptz not null default now(),
 foreign key(org_id,owner_user_id) references public.memberships(org_id,user_id),unique(org_id,owner_user_id,data_mode,guide_id)
);
create function app.prepare_shooting_work() returns trigger language plpgsql security definer set search_path='' as $$declare g public.case_guides;begin
 if new.owner_user_id<>auth.uid() or not app.is_member(new.org_id) then raise exception 'SHOOTING_FORBIDDEN';end if;
 select * into g from public.case_guides where id=new.guide_id and org_id=new.org_id and data_mode=new.data_mode and status='published';
 if g.id is null or g.content->'shooting' is null then raise exception 'SHOOTING_GUIDE_UNAVAILABLE';end if;
 new.guide_snapshot:=g.content;new.guide_revision:=g.revision;new.checked:='[]';new.notes:='{}';new.revision:=1;new.imported_revision:=0;return new;
end$$;
create trigger prepare_shooting_work before insert on public.shooting_work for each row execute function app.prepare_shooting_work();
revoke all on function app.prepare_shooting_work() from public,anon,authenticated;
alter table public.shooting_work enable row level security;
create policy shooting_owner on public.shooting_work for all to authenticated using(owner_user_id=auth.uid() and app.is_member(org_id)) with check(owner_user_id=auth.uid() and app.is_member(org_id));
revoke all on public.shooting_work from public,anon,authenticated;
grant select,insert on public.shooting_work to authenticated;
grant update(subject,checked,notes,memo,revision,imported_revision,updated_at) on public.shooting_work to authenticated;
grant all on public.shooting_work to service_role;
create index shooting_work_owner on public.shooting_work(org_id,owner_user_id,data_mode,updated_at desc);
