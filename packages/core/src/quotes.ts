import { AppError, CollectionTarget, enrichmentIds, canonicalJson, loadEnv, sha256Hex, type AppEnv, type JobKind } from '@xhs/domain';
import { pgCode, type Ctx, type ServiceRunner } from './context.ts';
import { APIFY_ACTOR } from '@xhs/providers';
import { enrichmentTarget, priceEnrichment } from './note-enrichment.ts';
import { orgOps } from './ops.ts';
import { OPERATION_ENDPOINTS, priceLiveOperation, recordLiveConsent, type LiveOperation } from './live.ts';

export type Operation = 'note_enrichment' | 'provider_search' | 'reference_analysis' | 'transcript_submit' | 'plan_generation' | 'contextual_check' | 'results_reflection';

/** App policy limits per student per day (spec 9.2; adjustable later by admins). */
export const DAILY_LIMITS: Record<Operation, { limit: number; label: string; kinds: JobKind[] }> = {
  note_enrichment: { limit: 10, label: '상세·표지 보완', kinds: ['provider_search', 'note_enrichment'] },
  provider_search: { limit: 10, label: '외부 검색', kinds: ['provider_search', 'note_enrichment'] },
  reference_analysis: { limit: 20, label: 'AI 작업', kinds: ['reference_analysis', 'query_expansion', 'plan_generation', 'contextual_check', 'results_reflection'] },
  transcript_submit: { limit: 5, label: '음성 문안 추출', kinds: ['transcript_submit'] },
  plan_generation: { limit: 20, label: 'AI 작업', kinds: ['reference_analysis', 'query_expansion', 'plan_generation', 'contextual_check', 'results_reflection'] },
  results_reflection: { limit: 20, label: 'AI 작업', kinds: ['reference_analysis', 'query_expansion', 'plan_generation', 'contextual_check', 'results_reflection'] },
  contextual_check: { limit: 20, label: 'AI 작업', kinds: ['reference_analysis', 'query_expansion', 'plan_generation', 'contextual_check', 'results_reflection'] },
};

export async function usedToday(ctx: Ctx, op: Operation): Promise<number> {
  const r = await ctx.db.query<{ n: number }>(
    `select count(*)::int as n from app_jobs where org_id = $1 and owner_user_id = $2 and kind = any($3) and created_at >= date_trunc('day', now())`,
    [ctx.orgId, ctx.uid, DAILY_LIMITS[op].kinds],
  );
  return r.rows[0]?.n ?? 0;
}

export type Quote = {
  id: string;
  operation: Operation;
  mode: 'mock' | 'live';
  maxAmount: string;
  currency: string;
  maxBillableUnits: number;
  expiresAt: string;
  usedToday: number;
  dailyLimit: number;
  requestHash: string;
};

export function requestHash(operation: Operation, scope: Record<string, unknown>): string {
  return sha256Hex(canonicalJson({ operation, scope }));
}

/**
 * Server-generated, single-use, 5-minute quote (spec 8, 9.2). In mock mode the
 * amount is 0 and the ledger row is `demo`. In live mode an unknown price blocks.
 */
const FEATURE_OF: Record<Operation, 'ai' | 'transcript' | 'provider_search'> = {
  note_enrichment: 'provider_search', provider_search: 'provider_search', transcript_submit: 'transcript', reference_analysis: 'ai', plan_generation: 'ai', contextual_check: 'ai', results_reflection: 'ai',
};

/** Effective daily limit: org setting (admin-adjustable) falling back to the app default. */
export async function dailyLimit(ctx: Ctx, op: Operation): Promise<number> {
  const ops = await orgOps(ctx.db, ctx.orgId);
  return ops.limits[FEATURE_OF[op]];
}

export async function createQuote(ctx: Ctx, service: ServiceRunner, operation: Operation, scope: Record<string, unknown>, opts: { env?: AppEnv } = {}): Promise<Quote> {
  if (operation === 'note_enrichment') await enrichmentTarget(ctx, scope);
  if (operation === 'provider_search' && scope.targetCount !== undefined) CollectionTarget.parse(scope.targetCount);
  const ops = await orgOps(ctx.db, ctx.orgId);
  if (ops.provider.kill) throw new AppError('FEATURE_DISABLED', '관리자가 외부 작업을 모두 중지했습니다.');
  if (!ops.features[FEATURE_OF[operation]]) throw new AppError('FEATURE_DISABLED', '관리자가 이 기능을 꺼 두었습니다.');
  const used = await usedToday(ctx, operation);
  const limit = ops.limits[FEATURE_OF[operation]];
  if (used >= limit) throw new AppError('RATE_LIMITED', `오늘 ${DAILY_LIMITS[operation].label} 한도(${limit}회)를 모두 사용했습니다.`);
  const hash = requestHash(operation, scope);
  if (ctx.mode === 'live') {
    // Unknown price, blocked gate, zero budget or a provider without a contract refuse here (spec 6.3, 9.2).
    const env = opts.env ?? loadEnv(process.env);
    const priced = operation === 'note_enrichment' ? await priceEnrichment(ctx, service, env, enrichmentIds(scope).length) : await priceLiveOperation(ctx, service, operation, env, scope);
    const row = await service(async (db) => (await db.query<{ id: string; expires_at: Date }>(
      `insert into cost_quotes (org_id, owner_user_id, operation, request_hash, data_mode, scope_json, max_billable_units, max_amount, currency, price_version_ids, permission_versions)
       values ($1, $2, $3, $4, 'live', $5, $6, $7, $8, $9, $10) returning id, expires_at`,
      [ctx.orgId, ctx.uid, operation, hash,
       { ...scope, ...(operation === 'note_enrichment' ? { actor: APIFY_ACTOR, actorBuild: env.APIFY_ACTOR_BUILD, runCapUsd: priced.prices[0]!.unitCost } : {}), provider: operation === 'note_enrichment' ? 'apify' : 'redfox', endpoint: priced.prices[0]!.endpoint, prices: priced.prices.map((p) => ({ endpoint: p.endpoint, units: p.units, unitCost: p.unitCost, unit: p.unit })) },
       priced.maxUnits, priced.maxAmount, priced.currency, priced.prices.map((p) => p.priceVersionId), {}],
    )).rows[0]!);
    return {
      id: row.id, operation, mode: 'live', maxAmount: priced.maxAmount, currency: priced.currency, maxBillableUnits: priced.maxUnits,
      expiresAt: row.expires_at.toISOString(), usedToday: used, dailyLimit: limit, requestHash: hash,
    };
  }
  const row = await service(async (db) => (await db.query<{ id: string; expires_at: Date }>(
    `insert into cost_quotes (org_id, owner_user_id, operation, request_hash, data_mode, scope_json, max_billable_units, max_amount, currency)
     values ($1, $2, $3, $4, 'mock', $5, 1, 0, 'CNY') returning id, expires_at`,
    [ctx.orgId, ctx.uid, operation, hash, { ...scope, provider: 'mock', endpoint: operation }],
  )).rows[0]!);
  return {
    id: row.id, operation, mode: 'mock', maxAmount: '0', currency: 'CNY', maxBillableUnits: 1,
    expiresAt: row.expires_at.toISOString(), usedToday: used, dailyLimit: limit, requestHash: hash,
  };
}


const QUOTE_ERRORS: Record<string, [ConstructorParameters<typeof AppError>[0], string]> = {
  QUOTE_CONSUMED: ['CONFLICT', '이미 사용한 견적입니다. 다시 견적을 받아 주세요.'],
  QUOTE_EXPIRED: ['CONFLICT', '견적이 만료되었습니다(5분). 다시 견적을 받아 주세요.'],
  QUOTE_INVALID: ['NOT_FOUND', '견적을 찾을 수 없습니다.'],
  QUOTE_REQUEST_MISMATCH: ['CONFLICT', '견적과 요청 내용이 다릅니다.'],
  IDEMPOTENCY_MISMATCH: ['IDEMPOTENCY_MISMATCH', '같은 요청 키로 다른 요청이 들어왔습니다.'],
  BUDGET_EXCEEDED: ['BUDGET_EXCEEDED', '설정된 사용 한도를 초과했습니다.'],
};

/** Consumes the quote and enqueues the job atomically; replays return the same job. */
export async function reserveJob(ctx: Ctx, args: {
  quoteId: string; route: string; idempotencyKey: string; operation: Operation; scope: Record<string, unknown>;
  jobKind: JobKind; dedupeKey: string; inputRef: Record<string, unknown>;
  /** Live quotes need the student's explicit consent to send the request to the provider. */
  consent?: boolean;
}): Promise<{ jobId: string; replayed: boolean }> {
  if (args.operation === 'note_enrichment' || args.jobKind === 'note_enrichment') {
    if (args.operation !== 'note_enrichment' || args.jobKind !== 'note_enrichment' || canonicalJson(args.inputRef) !== canonicalJson(args.scope)) throw new AppError('VALIDATION_FAILED', '상세 조회 견적과 작업이 다릅니다.');
    await enrichmentTarget(ctx, args.scope);
  }
  if (args.operation === 'provider_search' && args.scope.targetCount !== undefined && (args.jobKind !== 'provider_search' || canonicalJson(args.inputRef) !== canonicalJson(args.scope))) throw new AppError('VALIDATION_FAILED', '조회 견적과 작업 범위가 다릅니다.');
  const live = (await ctx.db.query(`select data_mode from cost_quotes where id = $1 and owner_user_id = $2`, [args.quoteId, ctx.uid])).rows[0]?.data_mode === 'live';
  if (live) {
    if (args.operation !== 'note_enrichment' && !(args.operation in OPERATION_ENDPOINTS)) throw new AppError('LIVE_BLOCKED', '이 기능은 아직 실제 연결이 없습니다.');
    if (!args.consent) throw new AppError('VALIDATION_FAILED', '외부 공급자에 요청을 보내는 것에 동의해야 실행할 수 있습니다.');
    if (args.operation === 'note_enrichment') {
      await ctx.db.query(`insert into consent_records(org_id,user_id,purpose,policy_version,scope) select $1,$2,'external_provider_query','apify-zen-detail-v1',$3 where not exists (select 1 from consent_records where org_id=$1 and user_id=$2 and policy_version='apify-zen-detail-v1' and scope=$3::jsonb and withdrawn_at is null)`, [ctx.orgId,ctx.uid,{operation:args.operation,quoteId:args.quoteId}]);
    } else await recordLiveConsent(ctx, args.operation as LiveOperation);
  }
  try {
    const r = await ctx.db.query<{ job_id: string; replayed: boolean }>(
      `select * from app.reserve_and_enqueue($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ctx.orgId, args.quoteId, args.route, args.idempotencyKey, requestHash(args.operation, args.scope), args.jobKind, args.dedupeKey, args.inputRef],
    );
    const row = r.rows[0]!;
    return { jobId: row.job_id, replayed: row.replayed };
  } catch (e) {
    const code = pgCode(e);
    const mapped = code ? QUOTE_ERRORS[code] : undefined;
    if (mapped) throw new AppError(mapped[0], mapped[1]);
    if (/app_jobs_org_id_dedupe_key_key/.test(String(e))) throw new AppError('CONFLICT', '같은 작업이 이미 진행 중입니다.');
    throw e;
  }
}

export type JobView = { id: string; kind: JobKind; state: string; errorCode: string | null; createdAt: string; updatedAt: string; dataMode: string; progress: { notes?: number; targetCount?: number; pages?: number; stopReason?: string; completed?: number; total?: number; covers?: number } | null };

export async function getJob(ctx: Ctx, id: string): Promise<JobView | null> {
  const r = (await ctx.db.query(
    `select id, kind, state, error_code, created_at, updated_at, data_mode, result_ref from app_jobs where id = $1 and org_id = $2`, [id, ctx.orgId],
  )).rows[0];
  return r ? { id: r.id, kind: r.kind, state: r.state, errorCode: r.error_code, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), dataMode: r.data_mode, progress: r.result_ref ? Object.fromEntries(Object.entries(r.result_ref).filter(([k,v]) => ['notes','targetCount','pages','completed','total','covers'].includes(k) && typeof v === 'number' || k === 'stopReason' && typeof v === 'string')) : null } : null;
}

export async function getQuote(ctx: Ctx, id: string): Promise<(Quote & { consumed: boolean; expired: boolean }) | null> {
  const r = (await ctx.db.query(
    `select id, operation, data_mode, max_amount, currency, max_billable_units, expires_at, request_hash, consumed_at from cost_quotes where id = $1 and org_id = $2 and owner_user_id = $3`,
    [id, ctx.orgId, ctx.uid],
  )).rows[0];
  if (!r) return null;
  const op = r.operation as Operation;
  return {
    id: r.id, operation: op, mode: r.data_mode, maxAmount: r.max_amount, currency: r.currency, maxBillableUnits: r.max_billable_units,
    expiresAt: r.expires_at.toISOString(), usedToday: await usedToday(ctx, op), dailyLimit: await dailyLimit(ctx, op), requestHash: r.request_hash,
    consumed: r.consumed_at !== null, expired: r.expires_at <= new Date(),
  };
}
