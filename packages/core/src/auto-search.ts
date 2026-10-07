import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, canonicalJson, normalizeSearchQuery, sha256Hex, type AppEnv } from '@xhs/domain';
import type { Ctx, ServiceRunner } from './context.ts';
import { requireAdmin } from './admin.ts';
import { createQuote, reserveJob } from './quotes.ts';

export const AutoSearchPolicy = z.object({
  enabled: z.boolean().default(false),
  cacheHours: z.number().int().min(1).max(168).default(24),
  perStudent: z.number().int().min(1).max(20).default(3),
  perDay: z.number().int().min(1).max(100).default(10),
  maxCny: z.string().regex(/^\d{1,4}(\.\d{1,8})?$/).default('0.30'),
  expiresAt: z.string().datetime().optional(),
  approvedBy: z.string().uuid().optional(),
});
export async function setAutoSearchPolicy(ctx: Ctx, input: unknown) {
  requireAdmin(ctx);
  const p=AutoSearchPolicy.parse(input);
  if(p.enabled && (!p.expiresAt || Date.parse(p.expiresAt)<=Date.now() || Date.parse(p.expiresAt)>Date.now()+31*86400_000 || Number(p.maxCny)<=0))
    throw new AppError('VALIDATION_FAILED','자동 검색 승인 기간(최대 31일)과 건당 상한을 확인하세요.');
  await ctx.db.query(`update organizations set settings=jsonb_set(settings,'{auto_search}',$2::jsonb),revision=revision+1 where id=$1`,[ctx.orgId,{...p,approvedBy:ctx.uid}]);
}
export async function autoSearchPolicy(ctx: Ctx) {
  const row=(await ctx.db.query(`select settings->'auto_search' as policy from organizations where id=$1`,[ctx.orgId])).rows[0];
  return AutoSearchPolicy.parse(row?.policy ?? {});
}

/** One transaction serializes cache lookup, daily caps and existing monetary reservation. */
export async function requestAutoSearch(ctx: Ctx, service: ServiceRunner, raw: string, env: AppEnv, filters: {topic?: string; days?: number} = {}): Promise<string | null> {
  const query=z.string().min(1).max(50).parse(normalizeSearchQuery(raw));
  const checked=z.object({topic:z.enum(['beauty','daily-life','parenting','food-places','travel-outing','fashion']).optional(),days:z.union([z.literal(7),z.literal(14),z.literal(30)]).optional()}).parse(filters);
  const scope={query,targetCount:50,...checked};
  const hash=sha256Hex(canonicalJson({...scope,mode:ctx.mode}));
  return service(async db=>{
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`auto-search:${ctx.orgId}`]);
    const member=await db.query(`select 1 from memberships where org_id=$1 and user_id=$2 and status='active'`,[ctx.orgId,ctx.uid]);
    if(!member.rowCount) throw new AppError('FORBIDDEN','조직에 접근할 수 없습니다.');
    const row=(await db.query(`select settings from organizations where id=$1 and status='active'`,[ctx.orgId])).rows[0];
    const policy=AutoSearchPolicy.parse(row?.settings?.auto_search ?? {});
    if(!policy.enabled || !policy.approvedBy || !policy.expiresAt || Date.parse(policy.expiresAt)<=Date.now()
      || (ctx.mode==='live' && !env.AUTO_REFRESH_ENABLED)) return null;
    const sponsor=(await db.query(`select 1 from memberships where org_id=$1 and user_id=$2 and role='org_admin' and status='active'`,[ctx.orgId,policy.approvedBy])).rowCount;
    if(!sponsor) return null;
    const cached=(await db.query(`select j.id from search_requests r join app_jobs j on j.id=r.job_id
      where r.org_id=$1 and r.query_hash=$2 and j.data_mode=$3
      and (j.state in ('queued','running','waiting_external','unknown_outcome') or
        (j.state='succeeded' and j.updated_at>now()-make_interval(hours=>$4)))
      order by r.created_at desc limit 1`,[ctx.orgId,hash,ctx.mode,policy.cacheHours])).rows[0];
    let jobId: string | undefined=cached?.id;
    if(!jobId) {
      const usage=(await db.query(`select count(distinct job_id)::int as total,
        count(distinct job_id) filter(where user_id=$2)::int as own from search_requests
        where org_id=$1 and created_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'`,[ctx.orgId,ctx.uid])).rows[0];
      if(usage.total>=policy.perDay || usage.own>=policy.perStudent) throw new AppError('RATE_LIMITED','오늘 새 게시물 검색 한도에 도달했습니다. 저장된 결과를 이용하세요.');
      await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[policy.approvedBy]);
      const sponsored: Ctx={...ctx,db,uid:policy.approvedBy,role:'org_admin'};
      const same: ServiceRunner=fn=>fn(db);
      const quote=await createQuote(sponsored,same,'provider_search',scope,{env});
      const within=(await db.query(`select $1::numeric <= $2::numeric as ok`,[quote.maxAmount,policy.maxCny])).rows[0]?.ok;
      if(ctx.mode==='live' && (quote.currency!=='CNY' || !within)) throw new AppError('BUDGET_EXCEEDED','새 게시물 검색의 운영 한도에 도달했습니다.');
      jobId=(await reserveJob(sponsored,{quoteId:quote.id,route:'POST /discover/automatic',idempotencyKey:randomUUID(),operation:'provider_search',scope,
        jobKind:'provider_search',dedupeKey:`auto-search:${quote.id}`,inputRef:scope,consent:true})).jobId;
    }
    return (await db.query(`insert into search_requests(org_id,user_id,query_hash,job_id) values($1,$2,$3,$4) on conflict(org_id,user_id,job_id) do update set query_hash=excluded.query_hash returning id`,[ctx.orgId,ctx.uid,hash,jobId])).rows[0].id as string;
  });
}
export async function autoSearchStatus(ctx: Ctx, service: ServiceRunner, id: string) {
  return service(async db=>{
    const row=(await db.query(`select j.state,j.data_mode from search_requests r join app_jobs j on j.id=r.job_id
      where r.id=$1 and r.org_id=$2 and r.user_id=$3 and j.data_mode=$4`,[id,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
    return row ? {state:row.state as string} : null;
  });
}
