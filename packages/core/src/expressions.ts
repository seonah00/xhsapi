import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { notFound, type Ctx } from './context.ts';
import { getReference } from './references.ts';

export type Explanations = { literal?: string; meaning?: string; nuance?: string; use?: string; avoid?: string; example?: string };

export type ExpressionCard = {
  id: string;
  expression: string;
  explanations: Explanations;
  tone: string | null;
  topics: string[];
  expressionType: 'basic' | 'observed_recent' | 'trend_unverified';
  provenance: 'editorial' | 'observed' | 'ai_suggestion' | 'transcript_observed';
  reviewStatus: string;
  personal: boolean;
  saved: boolean;
  evidence: { quote: string | null; observedAt: string }[];
};

export const ExpressionQuery = z.object({
  q: z.string().trim().max(50).optional(),
  tone: z.string().max(20).optional(),
  topic: z.string().max(40).optional(),
  scope: z.enum(['all', 'dictionary', 'mine', 'saved']).default('all'),
});

/** Reviewed shared dictionary and personal entries are listed separately-labelled, never merged (spec F07). */
export async function listExpressions(ctx: Ctx, input: unknown = {}): Promise<ExpressionCard[]> {
  const q = ExpressionQuery.parse(input);
  const params: unknown[] = [ctx.orgId, ctx.uid];
  const where = [`e.org_id = $1`, `((e.owner_user_id is null and e.review_status = 'published') or e.owner_user_id = $2)`];
  if (q.scope === 'dictionary') where.push('e.owner_user_id is null');
  if (q.scope === 'mine') where.push('e.owner_user_id = $2');
  if (q.scope === 'saved') where.push(`exists (select 1 from personal_saves s where s.target_type = 'expression' and s.target_id = e.id and s.owner_user_id = $2)`);
  if (q.q) { params.push(`%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where.push(`(e.expression ilike $${params.length} or e.explanations_json::text ilike $${params.length})`); }
  if (q.tone) { params.push(q.tone); where.push(`e.tone = $${params.length}`); }
  if (q.topic) { params.push(q.topic); where.push(`$${params.length} = any(e.topics)`); }
  const rows = (await ctx.db.query(
    `select e.*, exists (select 1 from personal_saves s where s.target_type = 'expression' and s.target_id = e.id and s.owner_user_id = $2) as saved,
            coalesce((select json_agg(json_build_object('quote', ev.quote_excerpt, 'observedAt', ev.observed_at)) from expression_evidence ev where ev.expression_id = e.id), '[]') as evidence
     from expressions e where ${where.join(' and ')} order by (e.owner_user_id is null) desc, e.expression limit 200`,
    params,
  )).rows;
  return rows.map((r) => ({
    id: r.id, expression: r.expression, explanations: r.explanations_json, tone: r.tone, topics: r.topics, expressionType: r.expression_type,
    provenance: r.provenance, reviewStatus: r.review_status, personal: r.owner_user_id !== null, saved: r.saved, evidence: r.evidence,
  }));
}

/** Save a phrase heard in a transcript as a personal, unreviewed entry (F15 → F07). */
export async function savePersonalExpression(ctx: Ctx, input: { expression: string; meaningKo?: string | undefined; referenceId?: string | undefined }): Promise<string> {
  const expression = z.string().trim().min(1).max(60).parse(input.expression);
  let provenance: 'transcript_observed' | 'observed' = 'observed';
  if (input.referenceId) {
    await getReference(ctx, input.referenceId);
    provenance = 'transcript_observed';
  }
  const id = (await ctx.db.query<{ id: string }>(
    `insert into expressions (org_id, owner_user_id, expression, explanations_json, provenance, expression_type, review_status, data_mode)
     values ($1, $2, $3, $4, $5, 'trend_unverified', 'draft', $6) returning id`,
    [ctx.orgId, ctx.uid, expression, input.meaningKo ? { meaning: input.meaningKo } : {}, provenance, ctx.mode],
  )).rows[0]!.id;
  return id;
}

export async function deletePersonalExpression(ctx: Ctx, id: string): Promise<void> {
  const r = await ctx.db.query(`delete from expressions where id = $1 and owner_user_id = $2`, [id, ctx.uid]);
  if (!r.rowCount) notFound();
}

export type ApplyResult = {
  matches: { expression: string; meaning: string | null; nuance: string | null; avoid: string | null; start: number; end: number }[];
  notes: string[];
  aiUsed: false;
};

/**
 * "내 문장에 적용" in P0: dictionary-based explanation only (no AI rewrite).
 * Offsets are UTF-16 indices into the user's own text.
 */
export async function explainSentence(ctx: Ctx, text: string): Promise<ApplyResult> {
  const t = z.string().min(1).max(500).parse(text);
  const dict = await listExpressions(ctx, { scope: 'dictionary' });
  const matches: ApplyResult['matches'] = [];
  for (const e of dict) {
    let from = 0;
    for (;;) {
      const i = t.indexOf(e.expression, from);
      if (i < 0) break;
      matches.push({ expression: e.expression, meaning: e.explanations.meaning ?? null, nuance: e.explanations.nuance ?? null, avoid: e.explanations.avoid ?? null, start: i, end: i + e.expression.length });
      from = i + e.expression.length;
    }
  }
  const notes = matches.length
    ? ['검수된 표현 사전에서 찾은 표현의 뜻과 주의 상황입니다. 문장 전체의 자연스러움은 판단하지 않았습니다.']
    : ['검수된 표현 사전에 있는 표현을 찾지 못했습니다. 문장이 틀렸다는 뜻은 아닙니다.'];
  if (ctx.mode === 'mock') notes.push('데모 모드: AI 문장 다듬기는 실행하지 않습니다.');
  return { matches: matches.sort((a, b) => a.start - b.start), notes, aiUsed: false };
}

export function assertNotEmpty(v: unknown): void {
  if (!v) throw new AppError('VALIDATION_FAILED', '입력이 비어 있습니다.');
}
