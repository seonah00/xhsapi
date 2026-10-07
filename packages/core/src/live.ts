import { AppError, type AppEnv } from '@xhs/domain';
import {
  evaluateLiveGate, REDFOX_CAPABILITIES, type EndpointCapability, type EndpointId, type GateContextFor, type GateReason, type PermissionPurpose,
  type ProviderPermission,
} from '@xhs/providers';
import type { Ctx, Db, ServiceRunner } from './context.ts';
import { requireAdmin } from './admin.ts';
import { orgOps } from './ops.ts';

/**
 * Live provider path (M5 preparation). Nothing here sends a request: it decides
 * prices, gate state and consent from stored records. The adapter re-checks the
 * gate immediately before each call.
 */

export type LiveOperation = 'provider_search' | 'transcript_submit';

/** Endpoints and maximum billable units an operation may use. RF14 is polled; each poll is reserved. */
export const OPERATION_ENDPOINTS: Record<LiveOperation, { endpoint: EndpointId; units: number }[]> = {
  provider_search: [{ endpoint: 'RF01', units: 1 }],
  transcript_submit: [{ endpoint: 'RF13', units: 1 }, { endpoint: 'RF14', units: 20 }],
};
/**
 * Keyword search uses RF02 (adds cover images, note type and read counts) once its price is verified and the
 * approved permission lists it; otherwise RF01. The choice is fixed in the quote and reused by the job.
 */
export function searchEndpointFor(st: Pick<LiveState, 'capabilities' | 'permission'>): 'RF01' | 'RF02' {
  return st.capabilities.RF02.priceStatus === 'verified' && st.permission?.status === 'approved' && st.permission.allowedEndpoints.includes('RF02') ? 'RF02' : 'RF01';
}

function planFor(operation: LiveOperation, st: Pick<LiveState, 'capabilities' | 'permission'>): { endpoint: EndpointId; units: number }[] {
  return operation === 'provider_search' ? [{ endpoint: searchEndpointFor(st), units: 1 }] : OPERATION_ENDPOINTS[operation];
}

export const MAX_TRANSCRIPT_POLLS = OPERATION_ENDPOINTS.transcript_submit[1]!.units;

export const CONSENT_PURPOSE: Record<LiveOperation, 'external_provider_query' | 'transcript'> = {
  provider_search: 'external_provider_query',
  transcript_submit: 'transcript',
};
export const LIVE_CONSENT_POLICY = 'live-provider-v1';

export function purposesFor(id: EndpointId): PermissionPurpose[] {
  return id === 'RF13' || id === 'RF14' ? ['fetch', 'excerpt_display'] : ['fetch', 'metadata_display'];
}

export const GATE_REASON_KO: Record<GateReason | 'budget_zero' | 'price_currency_mismatch', string> = {
  mode_not_live: '데모 모드', live_calls_disabled: '환경 설정 live 꺼짐', feature_disabled: '기능 환경 설정 꺼짐', org_switch_off: '조직 live 스위치 꺼짐/중지',
  parameter_unverified: '파라미터 미확인', not_implemented: '미구현', price_unknown: '단가 미확인', permission_missing: '이용 허가 없음',
  permission_inactive: '허가 미승인', permission_expired: '허가 만료', endpoint_not_permitted: '허가 범위 밖', purpose_not_permitted: '용도 미허가',
  consent_missing: '동의 없음', budget_not_reserved: '예산 미예약', not_user_approved: '사용자 미승인', budget_zero: 'live 예산 0',
  price_currency_mismatch: '엔드포인트 단가 통화가 서로 다름',
};

type LiveState = {
  orgLiveEnabled: boolean;
  capabilities: Record<EndpointId, EndpointCapability>;
  permission: ProviderPermission | null;
  liveBudget: { limit: string; currency: string } | null;
};

/** Org switches, DB capability status (prices may be verified there), the best permission and the current org budget. */
export async function loadLiveState(db: Db, orgId: string): Promise<LiveState> {
  const ops = await orgOps(db, orgId);
  const dbCaps = new Map((await db.query(`select * from provider_capabilities where provider = 'redfox'`)).rows.map((c) => [c.endpoint as string, c]));
  const capabilities = Object.fromEntries((Object.keys(REDFOX_CAPABILITIES) as EndpointId[]).map((id) => {
    const c = dbCaps.get(id);
    return [id, { ...REDFOX_CAPABILITIES[id], ...(c ? { paramsStatus: c.params_status, priceStatus: c.price_status } : {}) }];
  })) as Record<EndpointId, EndpointCapability>;
  const p = (await db.query(
    `select * from provider_permissions where org_id = $1 and provider = 'redfox' order by (status = 'approved') desc, created_at desc limit 1`, [orgId],
  )).rows[0];
  const permission: ProviderPermission | null = p ? {
    id: p.id, status: p.status, expiresAt: p.expires_at, allowedEndpoints: p.allowed_endpoints,
    allows: { fetch: p.allow_fetch, metadata_display: p.allow_metadata_display, excerpt_display: p.allow_excerpt_display, media_display: p.allow_media_display,
      ai_processing: p.allow_ai_processing, cache: p.allow_cache },
  } : null;
  const b = (await db.query(
    `select amount_limit, currency from usage_budgets where org_id = $1 and subject_type = 'org' and period_start <= current_date and period_end > current_date
     order by amount_limit desc limit 1`, [orgId],
  )).rows[0];
  return {
    orgLiveEnabled: ops.provider.live && !ops.provider.kill, capabilities, permission,
    liveBudget: b && Number(b.amount_limit) > 0 ? { limit: String(b.amount_limit), currency: b.currency } : null,
  };
}

// ---------------------------------------------------------------- admin checklist

export type ReadinessRow = { endpoint: string; purpose: string; phase: string; ready: boolean; reasons: (GateReason | 'budget_zero')[] };

/** Evaluates the real gate per endpoint; consent, quote approval and reservation are checked per request. */
export async function liveReadiness(ctx: Ctx, env: AppEnv): Promise<{ rows: ReadinessRow[]; liveBudget: { limit: string; currency: string } | null; perRequest: string[]; searchEndpoint: 'RF01' | 'RF02' }> {
  requireAdmin(ctx);
  const st = await loadLiveState(ctx.db, ctx.orgId);
  const rows = (Object.keys(st.capabilities) as EndpointId[]).map((id) => {
    const g = evaluateLiveGate({ env, endpoint: st.capabilities[id], orgLiveEnabled: st.orgLiveEnabled, permission: st.permission, purposes: purposesFor(id),
      consentRecorded: true, budgetReserved: true, userApproved: true });
    const reasons: ReadinessRow['reasons'] = g.allowed ? [] : [...g.reasons];
    if (!st.liveBudget) reasons.push('budget_zero');
    return { endpoint: id, purpose: st.capabilities[id].purpose, phase: st.capabilities[id].phase, ready: reasons.length === 0, reasons };
  });
  return { rows, liveBudget: st.liveBudget, searchEndpoint: searchEndpointFor(st), perRequest: ['학생 동의 기록', '요청별 견적 확인(5분·1회용)', '예산 예약(트랜잭션)'] };
}

// ---------------------------------------------------------------- live quotes

export type LivePrice = { endpoint: EndpointId; units: number; priceVersionId: string; unitCost: string; currency: string; unit: string };

/**
 * Prices and gate pre-check for a live quote. Unknown price, a blocked gate or mixed
 * currencies refuse the quote before the student confirms anything. The maximum
 * amount is computed in SQL numeric (never JS floats).
 */
export async function priceLiveOperation(ctx: Ctx, service: ServiceRunner, operation: string, env: AppEnv): Promise<{ prices: LivePrice[]; maxAmount: string; currency: string; maxUnits: number }> {
  if (!(operation in OPERATION_ENDPOINTS)) throw new AppError('LIVE_BLOCKED', '이 기능은 아직 실제 연결이 없습니다(AI·OCR 등은 제공자 미선정).');
  // Students cannot read org permissions/budgets (RLS); the pre-check reads them with service rights.
  const st = await service((db) => loadLiveState(db, ctx.orgId));
  const plan = planFor(operation as LiveOperation, st);
  const reasons = new Set<string>();
  for (const { endpoint } of plan) {
    const g = evaluateLiveGate({ env, endpoint: st.capabilities[endpoint], orgLiveEnabled: st.orgLiveEnabled, permission: st.permission, purposes: purposesFor(endpoint),
      consentRecorded: true, budgetReserved: true, userApproved: true });
    if (!g.allowed) g.reasons.forEach((r) => reasons.add(r));
  }
  if (!st.liveBudget) reasons.add('budget_zero');
  const rows = (await ctx.db.query(
    `select distinct on (endpoint) id, endpoint, unit, unit_cost::text as unit_cost, currency from provider_price_versions
     where provider = 'redfox' and endpoint = any($1) and effective_at <= now() order by endpoint, effective_at desc`, [plan.map((p) => p.endpoint)],
  )).rows;
  const prices = plan.map((p) => {
    const r = rows.find((x) => x.endpoint === p.endpoint);
    if (!r) { reasons.add('price_unknown'); return null; }
    return { endpoint: p.endpoint, units: p.units, priceVersionId: r.id, unitCost: r.unit_cost, currency: r.currency, unit: r.unit } as LivePrice;
  }).filter((x): x is LivePrice => !!x);
  const currencies = new Set(prices.map((p) => p.currency));
  if (currencies.size > 1) reasons.add('price_currency_mismatch');
  if (reasons.size) {
    throw new AppError('LIVE_BLOCKED', `실제 호출 조건이 갖춰지지 않았습니다: ${[...reasons].map((r) => GATE_REASON_KO[r as keyof typeof GATE_REASON_KO] ?? r).join(', ')}`);
  }
  const total = (await ctx.db.query<{ total: string }>(
    `select coalesce(sum(c * u), 0)::numeric(20, 8)::text as total from unnest($1::numeric[], $2::int[]) as t(c, u)`,
    [prices.map((p) => p.unitCost), prices.map((p) => p.units)],
  )).rows[0]!.total;
  return { prices, maxAmount: total, currency: [...currencies][0]!, maxUnits: plan.reduce((n, p) => n + p.units, 0) };
}

/** Student consent for a live operation, recorded at confirmation (spec 6.3: consent is a gate condition). */
export async function recordLiveConsent(ctx: Ctx, operation: LiveOperation): Promise<void> {
  const purpose = CONSENT_PURPOSE[operation];
  const has = await ctx.db.query(`select 1 from consent_records where org_id = $1 and user_id = $2 and purpose = $3 and withdrawn_at is null`, [ctx.orgId, ctx.uid, purpose]);
  if (has.rowCount) return;
  await ctx.db.query(`insert into consent_records (org_id, user_id, purpose, policy_version, scope) values ($1, $2, $3, $4, $5)`,
    [ctx.orgId, ctx.uid, purpose, LIVE_CONSENT_POLICY, { operation }]);
}

// ---------------------------------------------------------------- worker gate

/**
 * Builds the adapter's gate resolver for one live job from stored state (service role).
 * budgetReserved/userApproved come from the job's own ledger row; RF14 polls use the
 * ledger of the submit job that created the transcript run.
 */
export async function liveGateForJob(db: Db, job: { id: string; org_id: string; owner_user_id: string | null; kind: string; reserved_usage_id: string | null; input_ref: Record<string, unknown> },
  env: AppEnv): Promise<{ gateFor: GateContextFor; capabilities: Record<EndpointId, EndpointCapability>; searchEndpoint: 'RF01' | 'RF02' }> {
  const st = await loadLiveState(db, job.org_id);
  let ledgerId = job.reserved_usage_id;
  if (!ledgerId && job.kind === 'transcript_result') {
    ledgerId = (await db.query(`select j.reserved_usage_id from transcript_runs r join app_jobs j on j.id = r.job_id where r.id = $1`, [job.input_ref.runId])).rows[0]?.reserved_usage_id ?? null;
  }
  const ledger = ledgerId ? (await db.query(
    `select l.status, l.reserved_amount, q.consumed_at, q.scope_json->>'endpoint' as endpoint from usage_ledger l left join cost_quotes q on q.id = l.quote_id where l.id = $1`, [ledgerId],
  )).rows[0] : null;
  const op: LiveOperation = job.kind.startsWith('transcript') ? 'transcript_submit' : 'provider_search';
  const consent = job.owner_user_id ? (await db.query(
    `select 1 from consent_records where org_id = $1 and user_id = $2 and purpose = $3 and withdrawn_at is null`, [job.org_id, job.owner_user_id, CONSENT_PURPOSE[op]],
  )).rowCount === 1 : false;
  const budgetReserved = !!ledger && ['reserved', 'settled'].includes(ledger.status) && Number(ledger.reserved_amount) >= 0;
  const userApproved = !!ledger?.consumed_at;
  const gateFor: GateContextFor = (endpoint) => ({
    env, orgLiveEnabled: st.orgLiveEnabled, permission: st.permission, purposes: purposesFor(endpoint), consentRecorded: consent, budgetReserved, userApproved,
  });
  // The search endpoint is the one the student was quoted for (and the reservation priced).
  return { gateFor, capabilities: st.capabilities, searchEndpoint: ledger?.endpoint === 'RF02' ? 'RF02' : 'RF01' };
}
