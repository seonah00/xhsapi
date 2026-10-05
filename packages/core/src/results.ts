import { AppError } from '@xhs/domain';
import { normalizeXhsNoteUrl, safeExternalHref, UnsafeUrlError } from '@xhs/security';
import { z } from 'zod';
import { notFound, type Ctx } from './context.ts';

/** Spec F11: all metrics nullable; missing is "unknown", never 0. */
export const METRIC_KEYS = ['views', 'likes', 'saves', 'comments', 'shares', 'follows_attributed', 'search_traffic', 'impressions'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
const metric = z.union([z.number().int().min(0).max(1_000_000_000), z.null()]).optional();
export const ResultMetrics = z.object(Object.fromEntries(METRIC_KEYS.map((k) => [k, metric])) as Record<MetricKey, typeof metric>);
export type ResultMetrics = z.infer<typeof ResultMetrics>;

export const PublicationInput = z.object({
  accountId: z.string().uuid(),
  planVersionId: z.string().uuid().optional(),
  noteUrl: z.string().trim().max(2000).optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  title: z.string().trim().max(200).optional(),
  topic: z.string().max(40).optional(),
  format: z.string().max(40).optional(),
  sponsorship: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  paidPromotion: z.enum(['yes', 'no', 'unknown']).default('unknown'),
});

export const SnapshotInput = z.object({
  observedAt: z.string().datetime({ offset: true }),
  source: z.enum(['manual', 'user_analytics_export']).default('manual'), // authorized_api is P2
  metrics: ResultMetrics,
});

export type Snapshot = { id: string; observedAt: string; enteredAt: string; source: string; metrics: ResultMetrics };
export type Publication = {
  id: string; accountId: string; accountName: string; title: string | null; noteUrl: string | null; publishedAt: string | null; topic: string | null; format: string | null;
  sponsorship: string; paidPromotion: string; planVersionId: string | null; planId: string | null; snapshots: Snapshot[];
};

function cleanUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    return normalizeXhsNoteUrl(u).canonicalUrl;
  } catch (e) {
    if (!(e instanceof UnsafeUrlError)) throw e;
    const safe = safeExternalHref(u);
    if (!safe) throw new AppError('VALIDATION_FAILED', 'http(s) 링크만 저장할 수 있습니다.');
    return safe;
  }
}

/** The student registers a post they published themselves (no automatic import in P0). */
export async function createPublication(ctx: Ctx, input: unknown): Promise<string> {
  const d = PublicationInput.parse(input);
  if (d.publishedAt && Date.parse(d.publishedAt) > Date.now() + 60_000) throw new AppError('VALIDATION_FAILED', '발행일은 미래일 수 없습니다.');
  const acc = await ctx.db.query(`select 1 from creator_accounts where id = $1 and owner_user_id = $2 and deleted_at is null`, [d.accountId, ctx.uid]);
  if (!acc.rowCount) notFound();
  if (d.planVersionId) {
    const v = await ctx.db.query(`select 1 from plan_versions v join plans p on p.id = v.plan_id where v.id = $1 and p.owner_user_id = $2 and v.kind = 'edit'`, [d.planVersionId, ctx.uid]);
    if (!v.rowCount) notFound();
  }
  return (await ctx.db.query<{ id: string }>(
    `insert into publication_records (org_id, owner_user_id, account_id, plan_version_id, note_url, published_at, title, topic, format, sponsorship, paid_promotion)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [ctx.orgId, ctx.uid, d.accountId, d.planVersionId ?? null, cleanUrl(d.noteUrl), d.publishedAt ?? null, d.title ?? null, d.topic ?? null, d.format ?? null, d.sponsorship, d.paidPromotion],
  )).rows[0]!.id;
}

/** Each entry is a new observation; existing snapshots are never overwritten (spec F11). */
export async function addSnapshot(ctx: Ctx, publicationId: string, input: unknown): Promise<string> {
  const d = SnapshotInput.parse(input);
  const pub = (await ctx.db.query(`select published_at from publication_records where id = $1 and owner_user_id = $2`, [publicationId, ctx.uid])).rows[0];
  if (!pub) notFound();
  const observed = Date.parse(d.observedAt);
  if (observed > Date.now() + 60_000) throw new AppError('VALIDATION_FAILED', '관찰 시각은 미래일 수 없습니다.');
  if (pub.published_at && observed < pub.published_at.getTime()) throw new AppError('VALIDATION_FAILED', '관찰 시각은 발행일 이후여야 합니다.');
  const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, d.metrics[k] ?? null]));
  if (Object.values(values).every((v) => v === null)) throw new AppError('VALIDATION_FAILED', '지표를 하나 이상 입력하세요. 모르는 값은 비워 두면 됩니다.');
  return (await ctx.db.query<{ id: string }>(
    `insert into result_snapshots (org_id, publication_id, observed_at, metric_source, values_json, attribution_scope) values ($1, $2, $3, $4, $5, 'post') returning id`,
    [ctx.orgId, publicationId, d.observedAt, d.source, values],
  )).rows[0]!.id;
}

export async function listPublications(ctx: Ctx, accountId?: string): Promise<Publication[]> {
  const pubs = (await ctx.db.query(
    `select p.*, a.display_name, v.plan_id from publication_records p join creator_accounts a on a.id = p.account_id left join plan_versions v on v.id = p.plan_version_id
     where p.org_id = $1 and p.owner_user_id = $2 and ($3::uuid is null or p.account_id = $3) order by p.published_at desc nulls last, p.created_at desc`,
    [ctx.orgId, ctx.uid, accountId ?? null],
  )).rows;
  const snaps = pubs.length ? (await ctx.db.query(
    `select id, publication_id, observed_at, entered_at, metric_source, values_json from result_snapshots where publication_id = any($1::uuid[]) order by observed_at desc`,
    [pubs.map((p) => p.id)],
  )).rows : [];
  return pubs.map((p) => ({
    id: p.id, accountId: p.account_id, accountName: p.display_name, title: p.title, noteUrl: p.note_url, publishedAt: p.published_at?.toISOString() ?? null,
    topic: p.topic, format: p.format, sponsorship: p.sponsorship, paidPromotion: p.paid_promotion, planVersionId: p.plan_version_id, planId: p.plan_id,
    snapshots: snaps.filter((s) => s.publication_id === p.id).map((s) => ({ id: s.id, observedAt: s.observed_at.toISOString(), enteredAt: s.entered_at.toISOString(), source: s.metric_source, metrics: s.values_json })),
  }));
}

export type CompareGroup = {
  key: string; posts: number; withData: number;
  median: Partial<Record<MetricKey, number | null>>;
  saveRate: { value: number | null; basis: number };
  paidIncluded: number;
};
export type Comparison = { groupBy: 'topic' | 'format' | 'month'; groups: CompareGroup[]; warnings: string[] };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Within one account only. Uses each post's latest observation; ratios only when
 * both values exist for the same snapshot (no save rate without views). Correlation, not cause.
 */
export function comparePublications(pubs: Publication[], groupBy: Comparison['groupBy']): Comparison {
  const keyOf = (p: Publication) => groupBy === 'month' ? (p.publishedAt?.slice(0, 7) ?? '발행일 미확인') : (p[groupBy] ?? '미분류');
  const groups = new Map<string, Publication[]>();
  for (const p of pubs) groups.set(keyOf(p), [...(groups.get(keyOf(p)) ?? []), p]);
  const warnings: string[] = [];
  const out: CompareGroup[] = [];
  const ages: number[] = [];
  for (const [key, list] of groups) {
    const latest = list.map((p) => ({ p, s: p.snapshots[0] })).filter((x) => x.s);
    for (const x of latest) if (x.p.publishedAt) ages.push(Date.parse(x.s!.observedAt) - Date.parse(x.p.publishedAt));
    const med: CompareGroup['median'] = {};
    for (const k of ['views', 'likes', 'saves', 'comments'] as const) {
      med[k] = median(latest.map((x) => x.s!.metrics[k]).filter((v): v is number => typeof v === 'number'));
    }
    const rates = latest.filter((x) => typeof x.s!.metrics.saves === 'number' && typeof x.s!.metrics.views === 'number' && x.s!.metrics.views! > 0)
      .map((x) => x.s!.metrics.saves! / x.s!.metrics.views!);
    out.push({ key, posts: list.length, withData: latest.length, median: med, saveRate: { value: median(rates), basis: rates.length }, paidIncluded: list.filter((p) => p.paidPromotion === 'yes').length });
  }
  if (out.some((g) => g.withData < 3)) warnings.push('표본이 3개 미만인 그룹이 있습니다. 차이를 일반화하지 마세요.');
  if (out.some((g) => g.paidIncluded > 0)) warnings.push('유료 프로모션 게시물이 포함되어 있습니다.');
  if (ages.length > 1 && Math.max(...ages) - Math.min(...ages) > 7 * 86_400_000) warnings.push('게시물마다 관찰 시점(발행 후 경과 시간)이 7일 이상 다릅니다.');
  warnings.push('본인 계정 안의 비교이며 인과관계가 아닙니다. 다음 촬영에서 검증할 가설로만 쓰세요.');
  return { groupBy, groups: out.sort((a, b) => b.posts - a.posts), warnings };
}

export async function deletePublication(ctx: Ctx, id: string): Promise<void> {
  const r = await ctx.db.query(`delete from publication_records where id = $1 and owner_user_id = $2`, [id, ctx.uid]);
  if (!r.rowCount) notFound();
}

export type ReflectionOutput = {
  basedOn: { snapshotIds: string[]; posts: number };
  observations: string[]; hypotheses: string[]; limitations: string[]; generator: 'mock-rules-v1';
};

/** Mock reflection: compares only the selected own snapshots; never changes the account direction. */
export function reflect(rows: { title: string | null; topic: string | null; format: string | null; metrics: ResultMetrics; paid: string }[], snapshotIds: string[]): ReflectionOutput {
  const withSaves = rows.filter((r) => typeof r.metrics.saves === 'number');
  const obs: string[] = [];
  const hyp: string[] = [];
  if (withSaves.length >= 2) {
    const sorted = [...withSaves].sort((a, b) => (b.metrics.saves ?? 0) - (a.metrics.saves ?? 0));
    const top = sorted[0]!;
    const low = sorted[sorted.length - 1]!;
    obs.push(`선택한 게시물 중 저장 수가 가장 많은 것은 “${top.title ?? '제목 없음'}”(${top.metrics.saves})이고 가장 적은 것은 “${low.title ?? '제목 없음'}”(${low.metrics.saves})입니다.`);
    if (top.format && low.format && top.format !== low.format) hyp.push(`형식(${top.format} vs ${low.format})의 차이가 저장 수와 관련 있을 수 있습니다. 다음에 같은 주제를 두 형식으로 찍어 비교해 보세요.`);
    if (top.topic && low.topic && top.topic !== low.topic) hyp.push(`주제(${top.topic} vs ${low.topic})의 차이일 수도 있습니다. 한 번에 한 가지만 바꿔 검증하세요.`);
  } else {
    obs.push('저장 수가 입력된 게시물이 2개 미만이라 비교하지 않았습니다.');
  }
  if (hyp.length === 0) hyp.push('지표를 몇 번 더 같은 시점(예: 발행 3일 후)에 기록한 뒤 다시 비교해 보세요.');
  const limitations = ['선택한 본인 게시물만 사용했습니다. 다른 계정·시장 전체와 비교하지 않았습니다.', '원인을 단정하지 않습니다. 계정 방향은 자동으로 바뀌지 않습니다.'];
  if (rows.some((r) => r.paid === 'yes')) limitations.push('유료 프로모션 게시물이 포함되어 있어 자연 노출과 다를 수 있습니다.');
  if (rows.length < 3) limitations.push('표본이 매우 적습니다.');
  return { basedOn: { snapshotIds, posts: rows.length }, observations: obs, hypotheses: hyp, limitations, generator: 'mock-rules-v1' };
}

export async function listReflections(ctx: Ctx, accountId: string) {
  return (await ctx.db.query(
    `select id, created_at, output_json from analyses where org_id = $1 and owner_user_id = $2 and target_type = 'result_set' and target_id = $3 order by created_at desc limit 5`,
    [ctx.orgId, ctx.uid, accountId],
  )).rows.map((r) => ({ id: r.id as string, createdAt: r.created_at.toISOString() as string, output: r.output_json as ReflectionOutput }));
}
