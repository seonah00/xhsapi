import { AppError, type AppEnv } from '@xhs/domain';
import { REDFOX_CAPABILITIES } from '@xhs/providers';
import { z } from 'zod';
import { notFound, pgCode, type Ctx, type Db } from './context.ts';
import { requireAdmin } from './admin.ts';

// ---------------------------------------------------------------- org settings

export const FeatureSwitches = z.object({
  ai: z.boolean().default(true),
  transcript: z.boolean().default(true),
  provider_search: z.boolean().default(true),
});
export const ProviderSwitches = z.object({ live: z.boolean().default(false), kill: z.boolean().default(false) });
export const DailyLimits = z.object({
  provider_search: z.number().int().min(0).max(100).default(10),
  ai: z.number().int().min(0).max(100).default(20),
  transcript: z.number().int().min(0).max(100).default(5),
});
export type OrgOps = { revision: number; features: z.infer<typeof FeatureSwitches>; provider: z.infer<typeof ProviderSwitches>; limits: z.infer<typeof DailyLimits> };

export async function orgOps(db: Db, orgId: string): Promise<OrgOps> {
  const r = (await db.query(`select settings, revision from organizations where id = $1`, [orgId])).rows[0];
  if (!r) throw new AppError('NOT_FOUND', '조직을 찾을 수 없습니다.');
  const s = r.settings ?? {};
  return {
    revision: r.revision,
    features: FeatureSwitches.parse(s.feature_switches ?? {}),
    provider: ProviderSwitches.parse(s.provider_switches ?? {}),
    limits: DailyLimits.parse(s.daily_limits ?? {}),
  };
}

/** Org switches can only narrow what the environment allows (spec F12: env false cannot be overridden). */
export function effectiveSwitches(env: AppEnv, ops: OrgOps) {
  return {
    live: env.APP_DATA_MODE === 'live' && env.LIVE_PROVIDER_CALLS_ENABLED && ops.provider.live && !ops.provider.kill,
    transcriptLive: env.TRANSCRIPT_ENABLED && ops.features.transcript && !ops.provider.kill,
    ...ops.features,
    kill: ops.provider.kill,
  };
}

const STALE = () => new AppError('STALE_REVISION', '다른 관리자가 먼저 바꿨습니다. 새로고침 후 다시 시도하세요.');

async function updateSettings(ctx: Ctx, revision: number, patch: Record<string, unknown>): Promise<void> {
  requireAdmin(ctx);
  const r = await ctx.db.query(
    `update organizations set settings = settings || $3::jsonb, revision = revision + 1 where id = $1 and revision = $2`,
    [ctx.orgId, revision, JSON.stringify(patch)],
  );
  if (r.rowCount !== 1) throw STALE();
}

export async function setFeatureSwitches(ctx: Ctx, input: unknown, revision: number) {
  await updateSettings(ctx, revision, { feature_switches: FeatureSwitches.parse(input) });
}
export async function setProviderSwitches(ctx: Ctx, input: unknown, revision: number) {
  await updateSettings(ctx, revision, { provider_switches: ProviderSwitches.parse(input) });
}
export async function setDailyLimits(ctx: Ctx, input: unknown, revision: number) {
  await updateSettings(ctx, revision, { daily_limits: DailyLimits.parse(input) });
}

// ---------------------------------------------------------------- provider permissions

export const PermissionCreate = z.object({
  provider: z.literal('redfox'),
  scope: z.enum(['environment', 'cohort', 'internal']).default('environment'),
  allowedEndpoints: z.array(z.string().regex(/^RF\d{2}$/)).max(20).default([]),
  allowFetch: z.boolean().default(false),
  allowMetadataDisplay: z.boolean().default(false),
  allowExcerptDisplay: z.boolean().default(false),
  allowMediaDisplay: z.boolean().default(false),
  allowAiProcessing: z.boolean().default(false),
  allowCache: z.boolean().default(false),
  cacheTtlSeconds: z.number().int().positive().max(365 * 86400).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

export async function providerOverview(ctx: Ctx) {
  requireAdmin(ctx);
  const caps = (await ctx.db.query(`select * from provider_capabilities order by endpoint`)).rows;
  const perms = (await ctx.db.query(
    `select p.*, (select original_name from assets a where a.id = p.evidence_private_file_id) as evidence_name
     from provider_permissions p where p.org_id = $1 order by p.created_at desc`, [ctx.orgId],
  )).rows;
  return {
    capabilities: caps.map((c) => ({ endpoint: c.endpoint as string, path: c.path as string, paramsStatus: c.params_status as string, verificationStatus: c.verification_status as string,
      priceStatus: c.price_status as string, phase: c.phase as string, note: c.note as string | null })),
    permissions: perms.map((p) => ({
      id: p.id as string, provider: p.provider as string, scope: p.scope as string, status: p.status as string, endpoints: p.allowed_endpoints as string[],
      allows: { fetch: p.allow_fetch, metadata: p.allow_metadata_display, excerpt: p.allow_excerpt_display, media: p.allow_media_display, ai: p.allow_ai_processing, cache: p.allow_cache } as Record<string, boolean>,
      cacheTtlSeconds: p.cache_ttl_seconds as number | null, expiresAt: p.expires_at?.toISOString() ?? null, evidenceName: p.evidence_name as string | null,
      approvedAt: p.approved_at?.toISOString() ?? null, revision: p.revision as number,
    })),
  };
}

/** New permissions are always pending. Approval is a separate human step with evidence (spec 6.2). */
export async function createPermission(ctx: Ctx, input: unknown): Promise<string> {
  requireAdmin(ctx);
  const d = PermissionCreate.parse(input);
  const unknown = d.allowedEndpoints.filter((e) => !(e in REDFOX_CAPABILITIES));
  if (unknown.length) throw new AppError('VALIDATION_FAILED', `알 수 없는 엔드포인트: ${unknown.join(', ')}`);
  return (await ctx.db.query<{ id: string }>(
    `insert into provider_permissions (org_id, provider, scope, status, allowed_endpoints, allow_fetch, allow_metadata_display, allow_excerpt_display, allow_media_display,
       allow_ai_processing, allow_cache, cache_ttl_seconds, expires_at)
     values ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [ctx.orgId, d.provider, d.scope, d.allowedEndpoints, d.allowFetch, d.allowMetadataDisplay, d.allowExcerptDisplay, d.allowMediaDisplay, d.allowAiProcessing, d.allowCache,
     d.cacheTtlSeconds ?? null, d.expiresAt ?? null],
  )).rows[0]!.id;
}

export async function approvePermission(ctx: Ctx, id: string, input: { evidenceAssetId: string; confirm: boolean }): Promise<void> {
  requireAdmin(ctx);
  const d = z.object({ evidenceAssetId: z.string().uuid(), confirm: z.literal(true, { errorMap: () => ({ message: '증빙과 허가 범위를 확인했다고 체크하세요.' }) }) }).parse(input);
  const ev = await ctx.db.query(`select 1 from assets where id = $1 and org_id = $2 and purpose = 'permission_evidence' and deleted_at is null`, [d.evidenceAssetId, ctx.orgId]);
  if (!ev.rowCount) throw new AppError('VALIDATION_FAILED', '이 조직의 증빙 파일을 선택하세요.');
  try {
    const u = await ctx.db.query(
      `update provider_permissions set status = 'approved', evidence_private_file_id = $3, approved_by = $4, approved_at = now(), revision = revision + 1
       where id = $1 and org_id = $2 and status = 'pending'`, [id, ctx.orgId, d.evidenceAssetId, ctx.uid],
    );
    if (!u.rowCount) throw new AppError('CONFLICT', '대기 중인 허가만 승인할 수 있습니다.');
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (pgCode(e) || /check constraint|foreign key/.test(String(e))) throw new AppError('VALIDATION_FAILED', '승인 조건(증빙·승인자)을 확인하세요.');
    throw e;
  }
}

export async function revokePermission(ctx: Ctx, id: string): Promise<void> {
  requireAdmin(ctx);
  const r = await ctx.db.query(`update provider_permissions set status = 'revoked', revision = revision + 1 where id = $1 and org_id = $2 and status in ('pending', 'approved')`, [id, ctx.orgId]);
  if (!r.rowCount) notFound();
}

// ---------------------------------------------------------------- usage, budgets, reconcile

export async function usageSummary(ctx: Ctx, month: string) {
  requireAdmin(ctx);
  const m = z.string().regex(/^\d{4}-\d{2}$/).parse(month);
  const from = new Date(`${m}-01T00:00:00Z`);
  const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
  const rows = (await ctx.db.query(`select * from app.usage_summary($1, $2, $3)`, [ctx.orgId, from, to])).rows.map((r) => ({
    status: r.status as string, provider: r.provider as string, endpoint: r.endpoint as string, currency: r.currency as string,
    calls: Number(r.calls), reserved: r.reserved as string, actual: r.actual as string,
  }));
  const budgets = (await ctx.db.query(
    `select id, subject_type, currency, amount_limit, reserved_total, settled_total, period_start, period_end, revision from usage_budgets
     where org_id = $1 and subject_type = 'org' and period_start <= $2 and period_end > $2 order by currency`, [ctx.orgId, from],
  )).rows.map((b) => ({ id: b.id as string, currency: b.currency as string, limit: b.amount_limit as string, reserved: b.reserved_total as string, settled: b.settled_total as string,
    periodStart: b.period_start.toISOString().slice(0, 10), revision: b.revision as number }));
  const unknown = (await ctx.db.query(
    `select id, endpoint, currency, reserved_amount, occurred_at from usage_ledger where org_id = $1 and status = 'unknown_outcome' order by occurred_at`, [ctx.orgId],
  )).rows.map((u) => ({ id: u.id as string, endpoint: u.endpoint as string, currency: u.currency as string, reserved: u.reserved_amount as string, at: u.occurred_at.toISOString() }));
  return {
    month: m,
    demo: rows.filter((r) => r.status === 'demo'),
    real: rows.filter((r) => r.status !== 'demo'),
    budgets, unknown,
  };
}

/** Live budget for the month (default 0 = no live calls). Amounts are decimal strings, never floats. */
export async function setMonthlyBudget(ctx: Ctx, input: { currency: string; amount: string; month: string }): Promise<void> {
  requireAdmin(ctx);
  const d = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), amount: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/), month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(input);
  const start = `${d.month}-01`;
  try {
    await ctx.db.query(
      `insert into usage_budgets (org_id, subject_type, subject_id, period_start, period_end, currency, amount_limit, updated_by)
       values ($1, 'org', $1, $2::date, ($2::date + interval '1 month')::date, $3, $4::numeric, $5)
       on conflict (org_id, subject_type, subject_id, period_start, period_end, currency)
       do update set amount_limit = excluded.amount_limit, updated_by = excluded.updated_by, revision = usage_budgets.revision + 1`,
      [ctx.orgId, start, d.currency, d.amount, ctx.uid],
    );
  } catch (e) {
    if (/check constraint/.test(String(e))) throw new AppError('VALIDATION_FAILED', '이미 예약·정산된 금액보다 낮게 설정할 수 없습니다.');
    throw e;
  }
}

/** Resolves an unknown outcome only with billing evidence (spec 8: never mark free without confirmation). */
export async function reconcileUsage(ctx: Ctx, input: unknown): Promise<void> {
  requireAdmin(ctx);
  const d = z.object({ ledgerId: z.string().uuid(), outcome: z.enum(['settled', 'released']), actualAmount: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/).optional(), evidence: z.string().trim().min(5).max(500) }).parse(input);
  if (d.outcome === 'settled' && !d.actualAmount) throw new AppError('VALIDATION_FAILED', '정산 금액을 입력하세요.');
  try {
    await ctx.db.query(`select app.reconcile_usage($1, $2, $3::numeric, $4)`, [d.ledgerId, d.outcome, d.actualAmount ?? null, d.evidence]);
  } catch (e) {
    const code = pgCode(e);
    if (code === 'NOT_FOUND') notFound();
    if (code === 'EVIDENCE_REQUIRED') throw new AppError('VALIDATION_FAILED', '확인한 과금 증빙을 적어 주세요.');
    if (/VALIDATION_FAILED/.test(String(e))) throw new AppError('VALIDATION_FAILED', '정산 금액은 예약 금액 이하여야 합니다.');
    throw e;
  }
}

// ---------------------------------------------------------------- jobs

export async function listOrgJobs(ctx: Ctx, input: { state?: string; kind?: string } = {}) {
  requireAdmin(ctx);
  return (await ctx.db.query(
    `select * from admin_jobs where org_id = $1 and ($2::text is null or state = $2) and ($3::text is null or kind = $3) order by created_at desc limit 100`,
    [ctx.orgId, input.state ?? null, input.kind ?? null],
  )).rows.map((j) => ({ id: j.id as string, kind: j.kind as string, dataMode: j.data_mode as string, state: j.state as string, attempts: j.attempts as number,
    errorCode: j.error_code as string | null, createdAt: j.created_at.toISOString(), updatedAt: j.updated_at.toISOString() }));
}

/** Owner or org admin; only queued/waiting jobs. Remote work already sent is not guaranteed to be cancelled. */
export async function cancelJob(ctx: Ctx, id: string): Promise<void> {
  const ok = (await ctx.db.query<{ ok: boolean }>(`select app.cancel_job($1) as ok`, [id])).rows[0]?.ok;
  if (!ok) throw new AppError('CONFLICT', '대기 중인 작업만 취소할 수 있습니다.');
}
