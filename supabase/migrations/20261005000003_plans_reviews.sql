-- M2 core: plans, immutable versions, checks, submissions, feedback, results.
-- Reviewer access is granted only through an active submission in a cohort
-- where the reviewer is an active reviewer (spec F10). Owner policies alone
-- would leave reviewers unable to read real submissions, which is also a defect.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  account_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'planned', 'filming', 'ready', 'user_marked_published', 'archived')),
  current_version_id uuid,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, account_id) references public.creator_accounts(org_id, id),
  unique (org_id, id)
);
create index plans_owner on public.plans (org_id, owner_user_id, updated_at desc);
create trigger plans_touch before update on public.plans for each row execute function app.touch_updated_at();

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  plan_id uuid not null,
  version integer not null check (version > 0),
  kind text not null default 'edit' check (kind in ('edit', 'ai_proposal')),
  profile_version_id uuid,
  fact_sheet_json jsonb not null default '{}'::jsonb,
  content_json jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  check_input_hash text not null check (check_input_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  generation_job_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, plan_id) references public.plans(org_id, id) on delete cascade,
  foreign key (org_id, profile_version_id) references public.account_profile_versions(org_id, id),
  unique (plan_id, version),
  unique (org_id, id)
);
create trigger plan_versions_immutable before update or delete on public.plan_versions
  for each row execute function app.block_mutation();
alter table public.plans add constraint plans_current_version_fk
  foreign key (org_id, current_version_id) references public.plan_versions(org_id, id) deferrable initially deferred;

create table public.check_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = built-in editorial set
  rule_key text not null,
  version integer not null default 1,
  source_class text not null check (source_class in ('official_policy', 'law', 'provider_list', 'instructor_editorial', 'test_editorial')),
  source_url text,
  source_date date,
  reviewed_at timestamptz,
  review_due_at timestamptz,
  scope jsonb not null default '{}'::jsonb,       -- fields/topics the rule applies to
  match_config jsonb not null,                    -- {type: exact_phrase|keyword, value}
  finding_type text not null,
  severity text not null check (severity in ('high', 'medium', 'low', 'info')),
  rationale text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'review_overdue', 'retired')),
  unique (org_id, rule_key, version),
  -- P0 matcher: no user regex or code (spec F09), bounded size.
  check (match_config ->> 'type' in ('exact_phrase', 'keyword') and length(match_config ->> 'value') between 1 and 100),
  -- Official-class rules need source date and scope before activation.
  check (status <> 'active' or source_class in ('instructor_editorial', 'test_editorial') or (source_date is not null and source_url is not null and reviewed_at is not null))
);

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  plan_version_id uuid,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'), -- = check input hash of what was checked
  rules_version text not null,
  job_id uuid,
  status text not null check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  -- e.g. {"rules": "completed", "contextual": "failed"}
  completeness_json jsonb not null default '{}'::jsonb,
  data_mode text not null default 'mock' check (data_mode in ('mock', 'live')),
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, plan_version_id) references public.plan_versions(org_id, id),
  unique (org_id, id)
);

create table public.check_findings (
  id uuid primary key default gen_random_uuid(),
  check_run_id uuid not null references public.check_runs(id) on delete cascade,
  field_key text not null check (field_key in ('title', 'cover', 'body', 'tags', 'subtitles', 'document')),
  start_utf16 integer check (start_utf16 >= 0),
  end_utf16 integer,
  finding_type text not null,
  severity text not null check (severity in ('high', 'medium', 'low', 'info')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rule_id uuid references public.check_rules(id),
  anchored boolean not null default true,
  finding_json jsonb not null,
  check ((start_utf16 is null) = (end_utf16 is null)),
  check (end_utf16 is null or end_utf16 > start_utf16)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  cohort_id uuid not null,
  plan_version_id uuid not null,
  check_run_id uuid not null,
  acknowledged_incomplete_check boolean not null default false,
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'changes_requested', 'feedback_complete', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, cohort_id) references public.cohorts(org_id, id),
  foreign key (org_id, plan_version_id) references public.plan_versions(org_id, id),
  foreign key (org_id, check_run_id) references public.check_runs(org_id, id),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  unique (org_id, id)
);
create unique index submissions_one_active on public.submissions (plan_version_id, cohort_id) where status <> 'withdrawn';

create table public.submission_assets (
  submission_id uuid not null,
  asset_id uuid not null,
  org_id uuid not null,
  shared_by uuid not null,
  shared_at timestamptz not null default now(),
  primary key (submission_id, asset_id),
  foreign key (org_id, submission_id) references public.submissions(org_id, id) on delete cascade,
  foreign key (org_id, asset_id) references public.assets(org_id, id) on delete cascade
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id),
  content text not null check (length(content) between 1 and 10000),
  checklist_json jsonb not null default '[]'::jsonb,
  status text not null default 'comment' check (status in ('comment', 'changes_requested', 'feedback_complete')),
  created_at timestamptz not null default now()
);

create table public.publication_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_user_id uuid not null,
  account_id uuid not null,
  plan_version_id uuid,
  note_url text,
  published_at timestamptz,
  sponsorship text not null default 'unknown' check (sponsorship in ('yes', 'no', 'unknown')),
  paid_promotion text not null default 'unknown' check (paid_promotion in ('yes', 'no', 'unknown')),
  created_at timestamptz not null default now(),
  foreign key (org_id, owner_user_id) references public.memberships(org_id, user_id) on delete cascade,
  foreign key (org_id, account_id) references public.creator_accounts(org_id, id),
  foreign key (org_id, plan_version_id) references public.plan_versions(org_id, id),
  unique (org_id, id)
);

create table public.result_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  publication_id uuid not null,
  observed_at timestamptz not null,
  entered_at timestamptz not null default now(),
  metric_source text not null check (metric_source in ('manual', 'user_analytics_export', 'authorized_api')),
  -- views/likes/saves/comments/shares/follows_attributed/search_traffic/impressions: all nullable integers.
  values_json jsonb not null check (jsonb_typeof(values_json) = 'object'),
  attribution_scope text not null default 'post' check (attribution_scope in ('post', 'account_total')),
  foreign key (org_id, publication_id) references public.publication_records(org_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Visibility helper: active submission in a cohort the caller reviews.
-- ---------------------------------------------------------------------------
create or replace function app.reviewer_can_see_version(p_plan_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.plan_version_id = p_plan_version and s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)
  )
$$;
create or replace function app.reviewer_can_see_check(p_check_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.check_run_id = p_check_run and s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)
  )
$$;
grant execute on function app.reviewer_can_see_version(uuid), app.reviewer_can_see_check(uuid) to authenticated;

-- Submission validation (spec F10): owner, cohort membership, check hash match, completeness.
create or replace function app.validate_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pv public.plan_versions;
  v_plan public.plans;
  v_run public.check_runs;
begin
  select * into v_pv from public.plan_versions where id = new.plan_version_id and org_id = new.org_id;
  select * into v_plan from public.plans where id = v_pv.plan_id;
  if v_plan.owner_user_id is distinct from new.owner_user_id or v_plan.deleted_at is not null then
    raise exception 'SUBMISSION_NOT_OWNER' using errcode = 'P0001';
  end if;
  if v_pv.kind <> 'edit' then
    raise exception 'SUBMISSION_PROPOSAL_NOT_APPLIED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                 where cm.cohort_id = new.cohort_id and cm.user_id = new.owner_user_id and cm.role = 'student'
                   and cm.status = 'active' and c.status = 'active') then
    raise exception 'SUBMISSION_NOT_IN_COHORT' using errcode = 'P0001';
  end if;
  select * into v_run from public.check_runs where id = new.check_run_id and org_id = new.org_id;
  if v_run.owner_user_id is distinct from new.owner_user_id then
    raise exception 'SUBMISSION_CHECK_NOT_OWNER' using errcode = 'P0001';
  end if;
  if v_run.content_hash <> v_pv.check_input_hash then
    raise exception 'SUBMISSION_CHECK_STALE' using errcode = 'P0001';
  end if;
  if v_run.status = 'partial' then
    if coalesce(v_run.completeness_json ->> 'rules', '') <> 'completed' then
      raise exception 'SUBMISSION_CHECK_INCOMPLETE' using errcode = 'P0001';
    end if;
    if not new.acknowledged_incomplete_check then
      raise exception 'SUBMISSION_ACK_REQUIRED' using errcode = 'P0001';
    end if;
  elsif v_run.status <> 'completed' then
    raise exception 'SUBMISSION_CHECK_INCOMPLETE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger submissions_validate before insert on public.submissions
  for each row execute function app.validate_submission();

create or replace function app.validate_submission_asset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.submissions s join public.assets a on a.id = new.asset_id
                 where s.id = new.submission_id and s.owner_user_id = new.shared_by and a.owner_user_id = new.shared_by
                   and a.org_id = s.org_id and a.deleted_at is null and a.state = 'ready'
                   and a.rights_scope in ('shareable_with_reviewer', 'org_library')) then
    raise exception 'SUBMISSION_ASSET_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger submission_assets_validate before insert on public.submission_assets
  for each row execute function app.validate_submission_asset();

-- Status changes go through these functions only (no UPDATE grant on submissions).
create or replace function app.withdraw_submission(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  update public.submissions set status = 'withdrawn', withdrawn_at = now()
    where id = p_submission and owner_user_id = auth.uid() and status <> 'withdrawn'
    returning org_id into v_org;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app.audit(v_org, 'submission.withdrawn', 'submission', p_submission, '{}'::jsonb);
end $$;

create or replace function app.add_feedback(p_submission uuid, p_content text, p_status text, p_checklist jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.submissions;
  v_id uuid;
  v_next text;
begin
  select * into v_sub from public.submissions where id = p_submission for update;
  if not found or v_sub.status = 'withdrawn' or not app.is_cohort_reviewer(v_sub.cohort_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_status not in ('comment', 'changes_requested', 'feedback_complete') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  insert into public.feedback (submission_id, reviewer_user_id, content, checklist_json, status)
    values (p_submission, auth.uid(), p_content, coalesce(p_checklist, '[]'::jsonb), p_status) returning id into v_id;
  v_next := case p_status when 'comment' then 'in_review' else p_status end;
  update public.submissions set status = v_next where id = p_submission;
  return v_id;
end $$;

revoke all on function app.withdraw_submission(uuid), app.add_feedback(uuid, text, text, jsonb) from public;
grant execute on function app.withdraw_submission(uuid), app.add_feedback(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.check_rules enable row level security;
alter table public.check_runs enable row level security;
alter table public.check_findings enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_assets enable row level security;
alter table public.feedback enable row level security;
alter table public.publication_records enable row level security;
alter table public.result_snapshots enable row level security;

create policy owner_all on public.plans for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));

create policy owner_or_reviewer_read on public.plan_versions for select to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and p.owner_user_id = auth.uid() and app.is_member(p.org_id))
         or app.reviewer_can_see_version(id));
create policy owner_insert on public.plan_versions for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.plans p where p.id = plan_id and p.org_id = plan_versions.org_id and p.owner_user_id = auth.uid()));

create policy member_read on public.check_rules for select to authenticated
  using (org_id is null or app.is_member(org_id));
create policy admin_write on public.check_rules for all to authenticated
  using (org_id is not null and app.has_role(org_id, array['org_admin', 'reviewer']))
  with check (org_id is not null and app.has_role(org_id, array['org_admin', 'reviewer']));

create policy owner_or_reviewer_read on public.check_runs for select to authenticated
  using ((owner_user_id = auth.uid() and app.is_member(org_id)) or app.reviewer_can_see_check(id));
create policy owner_or_reviewer_read on public.check_findings for select to authenticated
  using (exists (select 1 from public.check_runs r where r.id = check_run_id and r.owner_user_id = auth.uid()) or app.reviewer_can_see_check(check_run_id));

create policy owner_read on public.submissions for select to authenticated
  using ((owner_user_id = auth.uid() and app.is_member(org_id)) or (status <> 'withdrawn' and app.is_cohort_reviewer(cohort_id)));
create policy owner_insert on public.submissions for insert to authenticated
  with check (owner_user_id = auth.uid() and app.is_member(org_id) and status = 'submitted');

create policy owner_or_reviewer_read on public.submission_assets for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id
                 and (s.owner_user_id = auth.uid() or (s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)))));
create policy owner_insert on public.submission_assets for insert to authenticated with check (shared_by = auth.uid());

create policy participants_read on public.feedback for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id
                 and (s.owner_user_id = auth.uid() or (s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id)))));

create policy owner_all on public.publication_records for all to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id)) with check (owner_user_id = auth.uid() and app.is_member(org_id));
create policy via_publication on public.result_snapshots for all to authenticated
  using (exists (select 1 from public.publication_records p where p.id = publication_id and p.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.publication_records p where p.id = publication_id and p.org_id = result_snapshots.org_id and p.owner_user_id = auth.uid()));

grant select, insert, update, delete on public.plans, public.publication_records, public.result_snapshots to authenticated;
grant select, insert on public.plan_versions, public.submissions, public.submission_assets to authenticated;
grant select, insert, update, delete on public.check_rules to authenticated;
grant select on public.check_runs, public.check_findings, public.feedback to authenticated;
