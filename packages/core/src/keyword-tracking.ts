import { z } from 'zod';
import { AppError, normalizeSearchQuery, type AppEnv } from '@xhs/domain';
import type { Ctx, ServiceRunner } from './context.ts';
import { requireAdmin } from './admin.ts';
import { requestAutoSearch } from './auto-search.ts';
import { getNotes } from './discover.ts';
import { keywordEvidence } from './keyword-evidence.ts';

const TrackingInput=z.object({term:z.string().transform(normalizeSearchQuery).pipe(z.string().min(1).max(50)),intervalDays:z.union([z.literal(1),z.literal(7),z.literal(30)]),enabled:z.boolean(),approvedUntil:z.string().datetime()});
export async function saveKeywordTracking(ctx:Ctx,service:ServiceRunner,raw:unknown) {
  requireAdmin(ctx);
  const input=TrackingInput.parse(raw);
  if(input.enabled && (Date.parse(input.approvedUntil)<=Date.now() || Date.parse(input.approvedUntil)>Date.now()+31*86400000)) throw new AppError('VALIDATION_FAILED','승인 기간은 오늘부터 최대 31일입니다.');
  return service(async db=>{
    const member=await db.query(`select 1 from memberships m join organizations o on o.id=m.org_id where m.org_id=$1 and m.user_id=$2 and m.status='active' and m.role='org_admin' and o.status='active'`,[ctx.orgId,ctx.uid]);
    if(!member.rowCount) throw new AppError('FORBIDDEN','관리자 권한이 필요합니다.');
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`keyword-tracking:${ctx.orgId}`]);
    const count=await db.query(`select count(*)::int as n from keyword_tracking where org_id=$1 and data_mode=$2 and term<>$3`,[ctx.orgId,ctx.mode,input.term]);
    if(count.rows[0].n>=30) throw new AppError('RATE_LIMITED','공용 추적 키워드는 모드별 최대 30개입니다.');
    // Preserve pending work and its owner on edits. Never cancel or re-dispatch an uncertain job.
    const existing=(await db.query(`select approved_by,pending_request_id from keyword_tracking where org_id=$1 and data_mode=$2 and term=$3 for update`,[ctx.orgId,ctx.mode,input.term])).rows[0];
    if(existing?.pending_request_id && existing.approved_by!==ctx.uid) throw new AppError('VALIDATION_FAILED','진행 중인 수집은 기존 승인 관리자가 변경해야 합니다.');
    const id=(await db.query(`insert into keyword_tracking(org_id,data_mode,term,interval_days,enabled,approved_by,approved_until,last_state)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(org_id,data_mode,term) do update set interval_days=excluded.interval_days,enabled=excluded.enabled,approved_by=excluded.approved_by,approved_until=excluded.approved_until,
      last_state=case when keyword_tracking.pending_request_id is not null then keyword_tracking.last_state else excluded.last_state end,updated_at=now() returning id`,
    [ctx.orgId,ctx.mode,input.term,input.intervalDays,input.enabled,ctx.uid,input.approvedUntil,input.enabled?'scheduled':'paused'])).rows[0].id as string;
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[ctx.uid]);
    await db.query(`select app.audit($1,'keyword_tracking.saved','keyword_tracking',$2,$3)`,[ctx.orgId,id,{enabled:input.enabled,intervalDays:input.intervalDays,approvedUntil:input.approvedUntil}]);
    return id;
  });
}

export type TrackingEvidence=ReturnType<typeof keywordEvidence>;
export type TrackingSnapshot={capturedAt:string;method:string;evidence:TrackingEvidence};
export function compareTrackingSnapshots(previous:TrackingSnapshot|undefined,current:TrackingSnapshot|undefined) {
  if(!previous || !current) return {status:'waiting',changePoints:null} as const;
  if(previous.method!==current.method) return {status:'method_changed',changePoints:null} as const;
  const a=previous.evidence,b=current.evidence;
  if(a.sampleSize<10 || b.sampleSize<10 || a.noteCount<3 || b.noteCount<3 || a.authorCount<2 || b.authorCount<2) return {status:'insufficient',changePoints:null} as const;
  return {status:'comparable',changePoints:100*(b.noteCount/b.sampleSize-a.noteCount/a.sampleSize)} as const;
}
export async function keywordTrackingHistory(ctx:Ctx) {
  const schedules=(await ctx.db.query(`select id,term,interval_days,enabled,approved_until,next_run_at,last_state from keyword_tracking where org_id=$1 and data_mode=$2 order by term`,[ctx.orgId,ctx.mode])).rows;
  const history=(await ctx.db.query(`select tracking_id,captured_at,method,evidence from keyword_tracking_snapshots where org_id=$1 and data_mode=$2 and captured_at>now()-interval '365 days' order by captured_at desc`,[ctx.orgId,ctx.mode])).rows;
  return schedules.map(s=>{
    const snapshots:TrackingSnapshot[]=history.filter(h=>h.tracking_id===s.id).map(h=>({capturedAt:new Date(h.captured_at).toISOString(),method:h.method,evidence:h.evidence}));
    return {id:s.id as string,term:s.term as string,intervalDays:s.interval_days as number,enabled:s.enabled as boolean,approvedUntil:new Date(s.approved_until).toISOString(),nextRunAt:new Date(s.next_run_at).toISOString(),state:s.last_state as string,snapshots,comparison:compareTrackingSnapshots(snapshots[1],snapshots[0])};
  });
}

/** Each schedule is locked through enqueue+reservation. No catch-up burst and no automatic failed/unknown retries. */
export async function tickKeywordTracking(service:ServiceRunner,env:AppEnv) {
  const ids=await service(async db=>(await db.query(`select id from keyword_tracking where data_mode=$1 and (pending_request_id is not null or (enabled and next_run_at<=now())) order by next_run_at limit 30`,[env.APP_DATA_MODE])).rows.map(r=>r.id as string));
  for(const id of ids) await service(async db=>{
    const s=(await db.query(`select * from keyword_tracking where id=$1 for update skip locked`,[id])).rows[0];
    if(!s) return;
    const pause=async(state:string)=>{await db.query(`update keyword_tracking set enabled=false,last_state=$2,pending_request_id=null,pending_method=null,updated_at=now() where id=$1`,[id,state]);};
    const ctx:Ctx={db,uid:s.approved_by,orgId:s.org_id,mode:s.data_mode,role:'org_admin'};
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[ctx.uid]);
    if(s.pending_request_id) {
      const job=(await db.query(`select j.id,j.state,j.updated_at,coalesce(j.result_ref->'fetchedNoteIds',j.result_ref->'noteIds','[]'::jsonb) as note_ids from search_requests r join app_jobs j on j.id=r.job_id where r.id=$1 and r.org_id=$2 and r.user_id=$3 and j.org_id=$2 and j.data_mode=$4 and j.kind='provider_search'`,[s.pending_request_id,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
      if(!job) return pause('missing_job');
      if(['queued','running','waiting_external'].includes(job.state)) return;
      if(job.state!=='succeeded') return pause(job.state==='unknown_outcome'?'unknown_outcome':'failed');
      const noteIds=z.array(z.string().uuid()).parse(job.note_ids).slice(0,50);
      const accessible=(await db.query(`select id from notes where id=any($1::uuid[]) and org_id=$2 and data_mode=$3 and (expires_at is null or expires_at>now())`,[noteIds,ctx.orgId,ctx.mode])).rows.map(r=>r.id as string);
      // Missing/expired source rows cannot become an artificial zero observation.
      if(!noteIds.length || accessible.length!==noteIds.length) return pause('source_unavailable');
      const evidence=keywordEvidence(s.term,await getNotes(ctx,accessible));
      await db.query(`insert into keyword_tracking_snapshots(tracking_id,org_id,data_mode,job_id,captured_at,method,evidence) values($1,$2,$3,$4,$5,$6,$7) on conflict(tracking_id,job_id) do nothing`,[id,ctx.orgId,ctx.mode,job.id,job.updated_at,s.pending_method,evidence]);
      await db.query(`update keyword_tracking set pending_request_id=null,pending_method=null,last_state='succeeded',next_run_at=now()+make_interval(days=>interval_days),updated_at=now() where id=$1`,[id]);
      return;
    }
    if(!s.enabled || new Date(s.next_run_at).getTime()>Date.now()) return;
    if(new Date(s.approved_until).getTime()<=Date.now()) return pause('approval_expired');
    const admin=await db.query(`select 1 from memberships where org_id=$1 and user_id=$2 and role='org_admin' and status='active'`,[ctx.orgId,ctx.uid]);
    if(!admin.rowCount) return pause('admin_inactive');
    await db.query('savepoint keyword_enqueue');
    try {
      const requestId=await requestAutoSearch(ctx,fn=>fn(db),s.term,env);
      if(!requestId) {await pause('disabled');return;}
      const source=(await db.query(`select q.scope_json from search_requests r join usage_ledger l on l.job_id=r.job_id join cost_quotes q on q.id=l.quote_id where r.id=$1 and r.org_id=$2 limit 1`,[requestId,ctx.orgId])).rows[0]?.scope_json;
      const method=JSON.stringify({version:1,provider:source?.provider??ctx.mode,endpoint:source?.endpoint??'mock',actor:source?.actor??null,build:source?.actorBuild??null,targetCount:50,sort:'default'});
      await db.query(`update keyword_tracking set pending_request_id=$2,pending_method=$3,last_state='queued',updated_at=now() where id=$1`,[id,requestId,method]);
    } catch(e) {
      await db.query('rollback to savepoint keyword_enqueue');
      if(!(e instanceof AppError)) throw e;
      await pause(e.code);
    }
  });
  await service(db=>db.query(`delete from keyword_tracking_snapshots where captured_at<=now()-interval '365 days'`));
}
