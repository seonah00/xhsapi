-- M1 additions: author scale on notes, reference titles, analysis lookups.

alter table public.notes
  add column author_followers jsonb, -- MetricValue; ranges like 4w+ kept as bounds
  add column observed_at timestamptz;

alter table public.reference_items
  add column title text check (length(title) <= 200);

create index analyses_target on public.analyses (org_id, owner_user_id, target_type, target_id, created_at desc);
create index app_jobs_owner_kind_day on public.app_jobs (org_id, owner_user_id, kind, created_at);

-- Students request analyses through jobs; the worker writes results.
-- Owners may delete their own analyses (spec 10.1 deletion).
create policy owner_delete on public.analyses for delete to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));
grant delete on public.analyses to authenticated;

-- Personal expression entries can be edited/removed by their owner.
create policy own_update on public.expressions for update to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id))
  with check (owner_user_id = auth.uid() and review_status = 'draft');
create policy own_delete on public.expressions for delete to authenticated
  using (owner_user_id = auth.uid() and app.is_member(org_id));

-- Transcripts are per reference (owner-only). Cross-user reuse of a paid result
-- is deferred to P1 (needs an org-shared cache with its own permission checks).
drop index public.transcript_runs_one_success;
create unique index transcript_runs_one_success_per_reference on public.transcript_runs (reference_id) where status = 'succeeded';
