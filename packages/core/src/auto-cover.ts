import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type AppEnv } from '@xhs/domain';
import { requireAdmin } from './admin.ts';
import type { Ctx, ServiceRunner } from './context.ts';
import { createQuote, reserveJob } from './quotes.ts';

export const AutoCoverPolicy = z.object({
  enabled: z.boolean().default(false),
  perMonth: z.number().int().min(1).max(1000).default(20),
  maxUsd: z.string().regex(/^\d{1,4}(\.\d{1,8})?$/).default('0.30'),
  expiresAt: z.string().datetime().optional(),
  approvedBy: z.string().uuid().optional(),
});
export async function autoCoverPolicy(ctx: Ctx) {
  const r = (await ctx.db.query(`select settings->'auto_cover' as policy from organizations where id=$1`, [ctx.orgId])).rows[0];
  return AutoCoverPolicy.parse(r?.policy ?? {});
}
export async function setAutoCoverPolicy(ctx: Ctx, input: unknown) {
  requireAdmin(ctx);
  const p = AutoCoverPolicy.parse(input);
  if (p.enabled && (!p.expiresAt || Date.parse(p.expiresAt) <= Date.now() || Date.parse(p.expiresAt) > Date.now() + 31 * 86400_000 || Number(p.maxUsd) <= 0))
    throw new AppError('VALIDATION_FAILED', '표지 갱신 종료일(최대 31일)과 회당 상한을 확인하세요.');
  await ctx.db.query(`update organizations set settings=jsonb_set(settings,'{auto_cover}',$2::jsonb),revision=revision+1 where id=$1`, [ctx.orgId, {...p, approvedBy: ctx.uid}]);
}

/** Visible failures only; shared organization cap, 24-hour cooldown and unknown-result quarantine. */
export async function requestAutoCover(ctx: Ctx, service: ServiceRunner, rawIds: unknown, env: AppEnv): Promise<string | null> {
  const requested = [...new Set(z.array(z.string().uuid()).min(1).max(50).parse(rawIds))];
  return service(async db => {
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`auto-cover:${ctx.orgId}`]);
    if (!(await db.query(`select 1 from memberships where org_id=$1 and user_id=$2 and status='active'`, [ctx.orgId, ctx.uid])).rowCount)
      throw new AppError('FORBIDDEN', '조직에 접근할 수 없습니다.');
    const r = (await db.query(`select settings from organizations where id=$1 and status='active'`, [ctx.orgId])).rows[0];
    const p = AutoCoverPolicy.parse(r?.settings?.auto_cover ?? {});
    if (!p.enabled || !p.approvedBy || !p.expiresAt || Date.parse(p.expiresAt) <= Date.now() || (ctx.mode === 'live' && !env.APIFY_ENABLED)) return null;
    if (!(await db.query(`select 1 from memberships where org_id=$1 and user_id=$2 and role='org_admin' and status='active'`, [ctx.orgId, p.approvedBy])).rowCount) return null;
    const used = (await db.query(`select coalesce(sum(jsonb_array_length(input_ref->'noteIds')),0)::int as n from app_jobs
      where org_id=$1 and data_mode=$2 and dedupe_key like 'auto-cover:%'
      and created_at >= (date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`, [ctx.orgId, ctx.mode])).rows[0].n;
    const room = Math.min(5, p.perMonth - used);
    if (room <= 0) return null;
    const ids = (await db.query(`select n.id from notes n where n.id=any($1::uuid[]) and n.org_id=$2 and n.data_mode=$3
      and (n.expires_at is null or n.expires_at>now())
      and not exists (select 1 from app_jobs j where j.org_id=n.org_id and j.kind='note_enrichment' and j.data_mode=n.data_mode
        and (j.input_ref->'noteIds' ? n.id::text or j.input_ref->>'noteId'=n.id::text)
        and (j.created_at>now()-interval '24 hours' or j.state in ('queued','running','waiting_external','unknown_outcome')))
      order by array_position($1::uuid[],n.id) limit $4`, [requested, ctx.orgId, ctx.mode, room])).rows.map(r => r.id as string);
    if (!ids.length) return null;
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [p.approvedBy]);
    const sponsor: Ctx = {...ctx, db, uid: p.approvedBy, role: 'org_admin'};
    const scope = {noteIds: ids};
    const quote = await createQuote(sponsor, fn => fn(db), 'note_enrichment', scope, {env});
    if (ctx.mode === 'live' && (quote.currency !== 'USD' || !(await db.query(`select $1::numeric <= $2::numeric as ok`, [quote.maxAmount, p.maxUsd])).rows[0].ok))
      throw new AppError('BUDGET_EXCEEDED', '표지 갱신 운영 한도에 도달했습니다.');
    return (await reserveJob(sponsor, {quoteId: quote.id, route: 'POST /covers/automatic', idempotencyKey: randomUUID(), operation: 'note_enrichment', scope,
      jobKind: 'note_enrichment', dedupeKey: `auto-cover:${quote.id}`, inputRef: scope, consent: true})).jobId;
  });
}

/** Shared maintenance progress only. Never exposes a sponsor's inputs, quotes or private jobs. */
export async function autoCoverStatus(ctx: Ctx, service: ServiceRunner, id: string) {
  return service(async db => (await db.query(`select j.state from app_jobs j join memberships m on m.org_id=j.org_id
    where j.id=$1 and j.org_id=$2 and j.data_mode=$3 and j.dedupe_key like 'auto-cover:%' and m.user_id=$4 and m.status='active'`,
  [z.string().uuid().parse(id), ctx.orgId, ctx.mode, ctx.uid])).rows[0] ?? null);
}
