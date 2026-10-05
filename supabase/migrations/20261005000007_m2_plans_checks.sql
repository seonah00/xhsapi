-- M2: mutable working draft on plans (autosave), rule suggestions, reviewer helpers.

-- Autosave writes a mutable working copy guarded by plans.revision. Immutable
-- plan_versions are created only by explicit "save version", AI proposals and
-- applied proposals; checks and submissions always reference versions.
alter table public.plans
  add column draft_json jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_json) = 'object'),
  add column draft_updated_at timestamptz;

alter table public.check_rules
  add column suggestion_zh text check (length(suggestion_zh) <= 100),
  add column created_by uuid;

-- Org rule cap (spec F09: 1000 active rules per org).
create or replace function app.enforce_rule_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.org_id is not null and new.status = 'active'
     and (select count(*) from public.check_rules where org_id = new.org_id and status = 'active' and id <> new.id) >= 1000 then
    raise exception 'RULE_CAP: 1000 active rules per organization' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger check_rules_cap before insert or update of status on public.check_rules for each row execute function app.enforce_rule_cap();

-- Reviewers see the submitting student's email only through an active submission in their cohort.
create or replace function app.submission_author(p_submission uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from public.submissions s join auth.users u on u.id = s.owner_user_id
  where s.id = p_submission and s.status <> 'withdrawn' and (s.owner_user_id = auth.uid() or app.is_cohort_reviewer(s.cohort_id))
$$;
revoke all on function app.submission_author(uuid) from public;
grant execute on function app.submission_author(uuid) to authenticated;

-- Reviewers mark a submission in_review when they open it (no other status writes).
create or replace function app.start_review(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.submissions set status = 'in_review'
   where id = p_submission and status = 'submitted' and app.is_cohort_reviewer(cohort_id);
end $$;
revoke all on function app.start_review(uuid) from public;
grant execute on function app.start_review(uuid) to authenticated;

-- Plans: deleting a plan is a soft delete; versions stay immutable.
create index plan_versions_plan on public.plan_versions (plan_id, version desc);
create index check_runs_version on public.check_runs (plan_version_id, created_at desc);
create index submissions_cohort on public.submissions (cohort_id, submitted_at desc) where status <> 'withdrawn';
