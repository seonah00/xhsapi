import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { notFound, pgCode, type Ctx } from './context.ts';
import type { Explanations } from './expressions.ts';

/** Reviewers and org admins curate the shared dictionary and editorial rules (spec F07, F09, F12). */
export function requireStaff(ctx: Ctx): void {
  if (ctx.role !== 'reviewer' && ctx.role !== 'org_admin') throw new AppError('FORBIDDEN', '강사·관리자만 사용할 수 있습니다.');
}

// ------------------------------------------------------------- dictionary review

const EXPR_FLOW: Record<string, string[]> = { draft: ['reviewer_checked', 'retired'], reviewer_checked: ['published', 'draft', 'retired'], published: ['retired'], retired: ['draft'] };

export const ExpressionDraft = z.object({
  expression: z.string().trim().min(1).max(60),
  literal: z.string().trim().max(100).optional(),
  meaning: z.string().trim().min(1).max(200),
  nuance: z.string().trim().max(200).optional(),
  use: z.string().trim().max(200).optional(),
  avoid: z.string().trim().max(200).optional(),
  example: z.string().trim().max(200).optional(),
  tone: z.enum(['friendly', 'informative', 'humor', 'plain']).optional(),
  topics: z.array(z.string()).max(6).default([]),
  expressionType: z.enum(['basic', 'observed_recent', 'trend_unverified']).default('basic'),
});

export async function listDictionaryForReview(ctx: Ctx) {
  requireStaff(ctx);
  return (await ctx.db.query(
    `select id, expression, explanations_json, tone, topics, expression_type, provenance, review_status, version, created_at
     from expressions where org_id = $1 and owner_user_id is null order by case review_status when 'draft' then 0 when 'reviewer_checked' then 1 when 'published' then 2 else 3 end, expression`,
    [ctx.orgId],
  )).rows.map((r) => ({ id: r.id as string, expression: r.expression as string, explanations: r.explanations_json as Explanations, tone: r.tone as string | null, topics: r.topics as string[],
    expressionType: r.expression_type as string, provenance: r.provenance as string, reviewStatus: r.review_status as string, version: r.version as number }));
}

export async function createDictionaryDraft(ctx: Ctx, input: unknown): Promise<string> {
  requireStaff(ctx);
  const d = ExpressionDraft.parse(input);
  const explanations: Explanations = Object.fromEntries(Object.entries({ literal: d.literal, meaning: d.meaning, nuance: d.nuance, use: d.use, avoid: d.avoid, example: d.example }).filter(([, v]) => v));
  return (await ctx.db.query<{ id: string }>(
    `insert into expressions (org_id, owner_user_id, expression, explanations_json, tone, topics, expression_type, provenance, review_status, data_mode)
     values ($1, null, $2, $3, $4, $5, $6, 'editorial', 'draft', $7) returning id`,
    [ctx.orgId, d.expression, explanations, d.tone ?? null, d.topics, d.expressionType, ctx.mode],
  )).rows[0]!.id;
}

/** draft → reviewer_checked → published → retired. Publishing needs a prior reviewer check (two steps). */
export async function reviewDictionaryEntry(ctx: Ctx, id: string, decision: string): Promise<void> {
  requireStaff(ctx);
  const cur = (await ctx.db.query<{ review_status: string; provenance: string }>(`select review_status, provenance from expressions where id = $1 and org_id = $2 and owner_user_id is null`, [id, ctx.orgId])).rows[0];
  if (!cur) notFound();
  if (!EXPR_FLOW[cur.review_status]?.includes(decision)) throw new AppError('CONFLICT', '허용되지 않는 상태 변경입니다.');
  if (decision === 'published' && cur.provenance === 'ai_suggestion') throw new AppError('VALIDATION_FAILED', 'AI 제안은 편집 사전으로 다시 작성한 뒤 공개하세요.');
  await ctx.db.query(`update expressions set review_status = $2, version = version + case when $2 = 'published' then 1 else 0 end where id = $1`, [id, decision]);
}

// ------------------------------------------------------------- editorial rules

export const RuleInput = z.object({
  ruleKey: z.string().trim().regex(/^[a-z0-9-]{3,40}$/, '영문 소문자·숫자·하이픈 3~40자'),
  matchType: z.enum(['exact_phrase', 'keyword']),
  value: z.string().trim().min(1).max(100),
  fields: z.array(z.enum(['title', 'cover', 'body', 'tags', 'subtitles'])).min(1),
  findingType: z.enum(['absolute_or_exaggerated_claim', 'unsupported_health_claim', 'sponsorship_review_needed', 'personal_information', 'child_privacy', 'language_awkwardness', 'source_uncertain']),
  severity: z.enum(['high', 'medium', 'low', 'info']),
  rationale: z.string().trim().min(5).max(500),
  suggestionZh: z.string().trim().max(100).optional(),
  sourceClass: z.enum(['instructor_editorial', 'official_policy', 'law']).default('instructor_editorial'),
  sourceUrl: z.string().trim().url().max(500).optional(),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type RuleRow = {
  id: string; orgOwned: boolean; ruleKey: string; version: number; sourceClass: string; sourceUrl: string | null; sourceDate: string | null; value: string; matchType: string;
  fields: string[]; findingType: string; severity: string; rationale: string; suggestionZh: string | null; status: string; reviewedAt: string | null; reviewDueAt: string | null; overdue: boolean;
};

export async function listRules(ctx: Ctx): Promise<RuleRow[]> {
  requireStaff(ctx);
  return (await ctx.db.query(
    `select *, (review_due_at is not null and review_due_at < now()) as overdue from check_rules where org_id is null or org_id = $1 order by org_id nulls first, rule_key, version desc`, [ctx.orgId],
  )).rows.map((r) => ({ id: r.id, orgOwned: r.org_id !== null, ruleKey: r.rule_key, version: r.version, sourceClass: r.source_class, sourceUrl: r.source_url,
    sourceDate: r.source_date ? r.source_date.toISOString().slice(0, 10) : null, value: r.match_config.value, matchType: r.match_config.type, fields: r.scope.fields ?? [],
    findingType: r.finding_type, severity: r.severity, rationale: r.rationale, suggestionZh: r.suggestion_zh, status: r.status,
    reviewedAt: r.reviewed_at?.toISOString() ?? null, reviewDueAt: r.review_due_at?.toISOString() ?? null, overdue: r.overdue }));
}

/** New rules start as draft. Official/law classes need a source URL and date (DB check enforces on activation). */
export async function createRule(ctx: Ctx, input: unknown): Promise<string> {
  requireStaff(ctx);
  const d = RuleInput.parse(input);
  const version = (await ctx.db.query<{ v: number }>(`select coalesce(max(version), 0) + 1 as v from check_rules where org_id = $1 and rule_key = $2`, [ctx.orgId, d.ruleKey])).rows[0]!.v;
  return (await ctx.db.query<{ id: string }>(
    `insert into check_rules (org_id, rule_key, version, source_class, source_url, source_date, scope, match_config, finding_type, severity, rationale, suggestion_zh, status, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13) returning id`,
    [ctx.orgId, d.ruleKey, version, d.sourceClass, d.sourceUrl ?? null, d.sourceDate ?? null, { fields: d.fields }, { type: d.matchType, value: d.value },
     d.findingType, d.severity, d.rationale, d.suggestionZh ?? null, ctx.uid],
  )).rows[0]!.id;
}

/** Review = confirm the rule is still valid; sets reviewed_at and a 30-day due date. Retire keeps history. */
export async function reviewRule(ctx: Ctx, id: string, decision: 'activate' | 'reviewed' | 'retire'): Promise<void> {
  requireStaff(ctx);
  const cur = (await ctx.db.query(`select status, org_id from check_rules where id = $1`, [id])).rows[0];
  if (!cur || cur.org_id !== ctx.orgId) throw new AppError('NOT_FOUND', '이 조직의 규칙만 변경할 수 있습니다.');
  try {
    if (decision === 'retire') await ctx.db.query(`update check_rules set status = 'retired' where id = $1`, [id]);
    else await ctx.db.query(`update check_rules set status = 'active', reviewed_at = now(), review_due_at = now() + interval '30 days' where id = $1`, [id]);
  } catch (e) {
    if (/check constraint/.test(String(e))) throw new AppError('VALIDATION_FAILED', '공식 정책·법령 규칙은 출처 URL과 날짜가 있어야 활성화할 수 있습니다.');
    if (pgCode(e) === 'RULE_CAP') throw new AppError('CONFLICT', '조직 활성 규칙은 최대 1,000개입니다.');
    throw e;
  }
}
