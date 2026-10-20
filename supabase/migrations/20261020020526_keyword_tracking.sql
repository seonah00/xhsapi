-- Shared keyword schedules are opt-in; only server admin actions can mutate them.
create table public.keyword_tracking (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  data_mode text not null check(data_mode in ('mock','live')),
  term text not null check(length(term) between 1 and 50),
  interval_days integer not null default 7 check(interval_days in (1,7,30)),
  enabled boolean not null default false,
  approved_by uuid not null references auth.users(id),
  approved_until timestamptz not null,
  next_run_at timestamptz not null default now(),
  pending_request_id uuid references public.search_requests(id),
  pending_method text,
  last_state text not null default 'paused',
  updated_at timestamptz not null default now(),
  unique(org_id,data_mode,term),
  unique(id,org_id,data_mode)
);
create index keyword_tracking_due on public.keyword_tracking(next_run_at) where enabled or pending_request_id is not null;
create table public.keyword_tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  tracking_id uuid not null,
  org_id uuid not null,
  data_mode text not null,
  job_id uuid not null references public.app_jobs(id),
  captured_at timestamptz not null,
  method text not null,
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  foreign key(tracking_id,org_id,data_mode) references public.keyword_tracking(id,org_id,data_mode) on delete cascade,
  unique(tracking_id,job_id)
);
create index keyword_tracking_history on public.keyword_tracking_snapshots(tracking_id,captured_at desc);
create index keyword_tracking_expiry on public.keyword_tracking_snapshots(captured_at);
alter table public.keyword_tracking enable row level security;
alter table public.keyword_tracking_snapshots enable row level security;
create policy keyword_tracking_read on public.keyword_tracking for select to authenticated using(app.is_member(org_id));
create policy keyword_tracking_snapshots_read on public.keyword_tracking_snapshots for select to authenticated using(app.is_member(org_id));
revoke all on public.keyword_tracking,public.keyword_tracking_snapshots from public,anon,authenticated;
grant select on public.keyword_tracking,public.keyword_tracking_snapshots to authenticated;
grant all on public.keyword_tracking,public.keyword_tracking_snapshots to service_role;
