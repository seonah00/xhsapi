create table public.search_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  query_hash text not null,
  job_id uuid not null references public.app_jobs(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.search_requests enable row level security;
revoke all on public.search_requests from public,anon,authenticated;
grant all on public.search_requests to service_role;
create index search_requests_cache on public.search_requests(org_id,query_hash,created_at desc);
create unique index search_requests_user_job on public.search_requests(org_id,user_id,job_id);
