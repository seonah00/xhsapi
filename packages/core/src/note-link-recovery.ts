import { z } from 'zod';
import { AppError } from '@xhs/domain';
import { safeXhsAccessUrl } from '@xhs/security';
import { requireAdmin } from './admin.ts';
import { storeNoteAccessLink } from './note-links.ts';
import type { Ctx, ServiceRunner } from './context.ts';

const Actors={search:'zen-studio~rednote-search-scraper',detail:'zen-studio~rednote-note-detail-scraper'} as const;
export const RecoveryInput=z.object({source:z.enum(['search','detail']),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict();
const Id=z.string().regex(/^[a-f0-9]{24}$/i);
const StorageId=z.string().regex(/^[a-zA-Z0-9]{1,100}$/);
const Run=z.object({status:z.literal('SUCCEEDED'),finishedAt:z.string().datetime({offset:true}),defaultDatasetId:StorageId});

/** Queue a bounded, zero-reservation archive read where the existing worker key lives. */
export async function requestNoteLinkRecovery(ctx:Ctx,service:ServiceRunner,input:unknown) {
  requireAdmin(ctx);
  const scope=RecoveryInput.parse(input);
  if(ctx.mode!=='live') throw new AppError('FEATURE_DISABLED','운영 모드에서만 기존 Apify 결과를 복구할 수 있습니다.');
  return service(async db=>{
    const member=await db.query(`select 1 from memberships m join organizations o on o.id=m.org_id where m.org_id=$1 and m.user_id=$2 and m.role='org_admin' and m.status='active' and o.status='active'`,[ctx.orgId,ctx.uid]);
    if(!member.rowCount) throw new AppError('FORBIDDEN','현재 관리자 권한이 필요합니다.');
    const row=(await db.query(`insert into app_jobs(org_id,owner_user_id,kind,data_mode,input_ref,dedupe_key)
      values($1,$2,'note_link_recovery',$3,$4,$5) on conflict(org_id,dedupe_key) do update set dedupe_key=excluded.dedupe_key returning id`,
      [ctx.orgId,ctx.uid,ctx.mode,scope,`link-recovery:${ctx.uid}:${ctx.mode}:${scope.source}:${scope.offset}`])).rows[0];
    return row.id as string;
  });
}

/** Fixed GET-only endpoints. No Actor submit/retry, media retrieval or raw response logging. */
async function readJson(path:string,token:string,fetchImpl:typeof fetch) {
  let response:Response;
  try {response=await fetchImpl(`https://api.apify.com/v2/${path}`,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15_000)});}
  catch {throw new AppError('VALIDATION_FAILED','기존 Apify 결과를 읽지 못했습니다. 새 수집은 실행하지 않았습니다.');}
  if(!response.ok) throw new AppError('VALIDATION_FAILED',`기존 Apify 결과 조회에 실패했습니다 (${response.status}). 새 수집은 실행하지 않았습니다.`);
  try {return await response.json() as unknown;} catch {throw new AppError('VALIDATION_FAILED','기존 결과 형식을 확인할 수 없습니다.');}
}

/** Recover only exact IDs already visible to this organization's current data mode. */
export async function recoverStoredNoteLinks(ctx:Ctx,service:ServiceRunner,input:unknown,token:string|undefined,fetchImpl:typeof fetch=fetch) {
  requireAdmin(ctx);
  const scope=RecoveryInput.parse(input);
  if(ctx.mode!=='live' || !token?.trim()) throw new AppError('FEATURE_DISABLED','운영 모드와 서버의 Apify 키가 필요합니다. 새 수집 실행 스위치는 변경하지 않습니다.');
  const response=await readJson(`acts/${Actors[scope.source]}/runs?status=SUCCEEDED&desc=1&limit=10&offset=${scope.offset}`,token,fetchImpl);
  const parsed=z.object({data:z.object({items:z.array(Run).max(10),total:z.number().int().nonnegative()})}).safeParse(response);
  if(!parsed.success) throw new AppError('VALIDATION_FAILED','보관된 실행 목록 형식이 예상과 다릅니다.');
  const runs=parsed.data.data.items;
  const candidates=new Map<string,{url:string;at:Date}>();
  let rows=0,rejected=0;
  for(const run of runs) {
    const at=new Date(run.finishedAt);
    if(at.getTime()>Date.now()+60_000) throw new AppError('VALIDATION_FAILED','실행 완료 시각을 확인하세요.');
    const data=await readJson(`datasets/${run.defaultDatasetId}/items?format=json&clean=true&fields=id,url,xsec_token&limit=1000`,token,fetchImpl);
    if(!Array.isArray(data)||data.length>1000) throw new AppError('VALIDATION_FAILED','보관된 결과 형식이 예상과 다릅니다.');
    rows+=data.length;
    for(const row of data) {
      const n=z.object({id:Id,url:z.string(),xsec_token:z.string().optional().nullable()}).safeParse(row);
      const url=n.success?safeXhsAccessUrl(n.data.url,n.data.id,n.data.xsec_token):null;
      if(!n.success||!url) {rejected++;continue;}
      const previous=candidates.get(n.data.id);
      if(!previous||previous.at<at) candidates.set(n.data.id,{url,at});
    }
  }
  // No writes until every bounded GET succeeds; repeating a page is safe and never submits an Actor.
  const notes=(await ctx.db.query<{id:string;platform_note_id:string}>(`select id,platform_note_id from notes where org_id=$1 and data_mode=$2
    and platform_note_id=any($3::text[]) and (expires_at is null or expires_at>now())`,[ctx.orgId,ctx.mode,[...candidates.keys()]])).rows;
  const linked=await service(async db=>{
    let count=0;
    for(const note of notes) {
      const candidate=candidates.get(note.platform_note_id)!;
      if(await storeNoteAccessLink(db,ctx.orgId,note.id,note.platform_note_id,candidate.url,candidate.at)) count++;
    }
    return count;
  });
  return {runs:runs.length,rows,rejected,matched:notes.length,linked,unchanged:notes.length-linked,
    nextOffset:scope.offset+runs.length<parsed.data.data.total&&runs.length?scope.offset+runs.length:null};
}
