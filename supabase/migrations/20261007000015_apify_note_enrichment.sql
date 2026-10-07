-- Selected-note enrichment is separate from RedFox search data and uses its own permission and USD budget.
insert into public.provider_capabilities(provider,endpoint,path,params_status,verification_status,price_status,phase,note)
values ('apify','AP01','/v2/actors/socialdatax~socialdatax-xhs-data-api/run-sync-get-dataset-items','documented','documented','unknown','P0','SocialDataX note detail; pinned build; verified USD/run cap required');

alter table public.app_jobs drop constraint app_jobs_kind_check;
alter table public.app_jobs add constraint app_jobs_kind_check check(kind in (
  'provider_search','note_enrichment','rank_refresh','reference_analysis','query_expansion','plan_generation','contextual_check',
  'results_reflection','trend_aggregation','data_expiry','user_deletion','transcript_submit','transcript_result','ocr','comment_submit','comment_result','csv_import'));

create table public.note_enrichments (
  note_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  permission_id uuid not null,
  title text, body_excerpt text check(length(body_excerpt)<=200), cover_url text,
  note_type text check(note_type in ('video','image')), provider_tags text[] not null default '{}',
  metrics_json jsonb not null default '{}', actor_build text not null, job_id uuid not null references public.app_jobs(id),
  fetched_at timestamptz not null default now(), expires_at timestamptz not null,
  foreign key (org_id,note_id) references public.notes(org_id,id) on delete cascade,
  foreign key (org_id,permission_id) references public.provider_permissions(org_id,id)
);

create function app.can_read_note_enrichment(p_org uuid,p_permission uuid,p_expires timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select app.is_member(p_org) and p_expires>now() and exists (
    select 1 from public.provider_permissions p where p.id=p_permission and p.org_id=p_org and p.provider='apify'
      and p.status='approved' and 'AP01'=any(p.allowed_endpoints) and p.allow_fetch and p.allow_metadata_display
      and p.allow_excerpt_display and p.allow_media_display and p.allow_cache and p.cache_ttl_seconds>0
      and (p.expires_at is null or p.expires_at>now())
  );
$$;
revoke all on function app.can_read_note_enrichment(uuid,uuid,timestamptz) from public;
grant execute on function app.can_read_note_enrichment(uuid,uuid,timestamptz) to authenticated,service_role;
alter table public.note_enrichments enable row level security;
create policy read_permitted on public.note_enrichments for select to authenticated
  using(app.can_read_note_enrichment(org_id,permission_id,expires_at));
revoke all on public.note_enrichments from anon,authenticated;
grant select on public.note_enrichments to authenticated;
grant all on public.note_enrichments to service_role;
