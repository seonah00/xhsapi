import { z } from 'zod';
import { AppError, type AppEnv } from '@xhs/domain';
import type { Ctx, ServiceRunner } from './context.ts';
import { KeywordPlanSource, keywordPlanCandidates } from './keyword-plan.ts';
import { requestAutoSearch } from './auto-search.ts';
import { getNotes } from './discover.ts';
import { keywordEvidence, keywordTrend } from './keyword-evidence.ts';

export const KeywordVerificationInput=z.object({source:KeywordPlanSource,terms:z.array(z.string().min(2).max(40)).min(1).max(3)}).strict();
/** Resolve candidates server-side; reserve the entire bounded batch atomically. Existing cache prevents duplicate dispatch. */
export async function verifyKeywordCandidates(ctx:Ctx,service:ServiceRunner,raw:unknown,env:AppEnv) {
  const input=KeywordVerificationInput.parse(raw);
  const candidates=await keywordPlanCandidates(ctx,input.source);
  const terms=[...new Set(input.terms)];
  if(terms.some(term=>!candidates.result.items.some(item=>item.term===term && item.noteCount===0))) throw new AppError('VALIDATION_FAILED','현재 검증 전 후보에서 최대 3개를 선택하세요.');
  return service(async db=>{
    const same:ServiceRunner=fn=>fn(db);
    const ids:string[]=[];
    for(const term of terms) {
      const id=await requestAutoSearch(ctx,same,term,env);
      if(!id) throw new AppError('FEATURE_DISABLED','새 게시물 검색이 비활성화되어 있습니다. 관리자에게 확인하세요.');
      ids.push(id);
    }
    return ids;
  });
}
/** Only this user's request IDs are accepted, even when the underlying job is shared/sponsored. */
export async function keywordVerificationResults(ctx:Ctx,service:ServiceRunner,raw:unknown) {
  const ids=z.array(z.string().uuid()).min(1).max(3).parse(raw);
  const jobs=await service(async db=>(await db.query(`select r.id,j.state,j.input_ref->>'query' as term,j.updated_at,
    coalesce(j.result_ref->'fetchedNoteIds',j.result_ref->'noteIds','[]'::jsonb) as note_ids
    from search_requests r join app_jobs j on j.id=r.job_id
    where r.id=any($1::uuid[]) and r.org_id=$2 and r.user_id=$3 and j.org_id=$2 and j.data_mode=$4 and j.kind='provider_search'`,[ids,ctx.orgId,ctx.uid,ctx.mode])).rows);
  if(jobs.length!==new Set(ids).size) throw new AppError('NOT_FOUND','검증 결과에 접근할 수 없습니다.');
  return Promise.all(jobs.map(async job=>{
    const noteIds=z.array(z.string().uuid()).parse(job.note_ids).slice(0,50);
    const accessible=job.state==='succeeded' && noteIds.length ? (await ctx.db.query(`select id from notes where id=any($1::uuid[]) and org_id=$2 and data_mode=$3 and (expires_at is null or expires_at>now())`,[noteIds,ctx.orgId,ctx.mode])).rows.map(row=>row.id as string) : [];
    const notes=await getNotes(ctx,accessible);
    return {requestId:job.id as string,term:job.term as string,state:job.state as string,checkedAt:new Date(job.updated_at).toISOString(),evidence:keywordEvidence(job.term,notes),trend:keywordTrend(job.term,notes),noteIds:notes.map(n=>n.id)};
  }));
}
