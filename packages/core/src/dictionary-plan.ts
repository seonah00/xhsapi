import { z } from 'zod';
import { AppError } from '@xhs/domain';
import type { Ctx } from './context.ts';
import { createPlan, getPlan, PlanContent, saveDraft, saveVersion } from './plans.ts';
import { getPublishedDictionaryEntries } from './shared-dictionary.ts';

export const DictionaryPlanInput = z.object({
  requestId: z.string().uuid(), accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  entryIds: z.array(z.string().uuid()).min(1).max(11),
  notes: z.string().max(2000), mode: z.enum(['record', 'plan']),
  disclosure: z.enum(['none', 'gifted', 'paid']),
  reviewNotes: z.array(z.string().max(1000)).max(30).default([]),
  content: PlanContent,
}).strict();

/** Explicit private save only. No provider call and no assertion that client text is verified AI output. */
export async function importDictionaryPlan(ctx: Ctx, raw: unknown): Promise<string> {
  const input = DictionaryPlanInput.parse(raw);
  // Serialize a double click/retry for this owner; the key remains on the draft after edits.
  await ctx.db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`dictionary-plan:${ctx.orgId}:${ctx.uid}:${input.requestId}`]);
  const existing = (await ctx.db.query(`select id, deleted_at from plans
    where org_id=$1 and owner_user_id=$2 and draft_json->'dictionarySource'->>'requestId'=$3`,
  [ctx.orgId, ctx.uid, input.requestId])).rows[0];
  if (existing) {
    if (existing.deleted_at) throw new AppError('CONFLICT', '이미 가져온 기획이 휴지통에 있습니다. 기획실에서 복원해 주세요.');
    return existing.id as string;
  }
  const entries = await getPublishedDictionaryEntries(ctx, [...new Set(input.entryIds)]);
  if (entries.length !== new Set(input.entryIds).size) throw new AppError('VALIDATION_FAILED', '공개가 종료된 사전 항목이 있습니다. 목록을 새로 확인해 주세요.');
  if (entries.filter(e => e.entryType === 'tag').length > 8 || entries.filter(e => e.entryType === 'expression').length > 3) {
    throw new AppError('VALIDATION_FAILED', '태그는 8개, 표현은 3개까지 가져올 수 있습니다.');
  }
  const id = await createPlan(ctx, { accountId: input.accountId, title: input.name });
  const created = await getPlan(ctx, id);
  const saved = await saveDraft(ctx, id, { content: input.content, facts: {
    sponsorship: input.disclosure === 'none' ? 'no' : 'yes',
    unknownFacts: ['사전에서 가져온 초안입니다. 본인 경험과 촬영 가능한 장면을 직접 확인해 주세요.'],
  } }, created.revision);
  await saveVersion(ctx, id, saved.revision);
  const dictionarySource = {
    reviewNotes: input.reviewNotes,
    requestId: input.requestId, mode: input.mode, notes: input.notes,
    entries: entries.map(e => ({ term: e.term, meaning: e.meaning, cautions: e.cautions, entryType: e.entryType })),
  };
  await ctx.db.query(`update plans set draft_json = draft_json || jsonb_build_object('dictionarySource', $2::jsonb) where id=$1`, [id, JSON.stringify(dictionarySource)]);
  return id;
}
