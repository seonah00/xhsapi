-- Collection/enrichment can pause between paid calls. Cancellation must account for work already sent.
create or replace function app.cancel_job(p_job uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.app_jobs; sent boolean;
begin
  select * into j from public.app_jobs where id=p_job and state in ('queued','waiting_external')
    and (owner_user_id=auth.uid() or app.has_role(org_id,array['org_admin'])) for update;
  if not found then return false; end if;
  update public.app_jobs set state='cancelled',error_code='cancelled_by_user' where id=p_job;
  if j.data_mode='live' and j.reserved_usage_id is not null
    and (j.kind='note_enrichment' or (j.kind='provider_search' and j.input_ref ? 'targetCount')) then
    sent := j.provider_task_id is not null or coalesce((j.result_ref->>'pages')::integer,0)>0
      or coalesce((j.result_ref->>'completed')::integer,0)>0;
    perform app.settle_usage(j.reserved_usage_id,case when sent then 'unknown_outcome' else 'released' end);
  end if;
  return true;
end $$;
