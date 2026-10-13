import { z } from 'zod';
import { AppError, canonicalTerm } from '@xhs/domain';
import type { Ctx } from './context.ts';
import { getNotes } from './discover.ts';
import { listSharedDictionary } from './shared-dictionary.ts';
import { chineseSearchCandidate, observedDictionary } from './search-language.ts';
import { recommendKeywords, type KeywordRecommendation } from './keyword-recommendations.ts';

export const KeywordScope = z.object({
  query: z.string().trim().min(1).max(200),
  noteIds: z.array(z.string().uuid()).max(50).refine(ids => new Set(ids).size === ids.length).default([]),
}).strict();
export async function keywordResearch(ctx: Ctx, raw: unknown) {
  const scope = KeywordScope.parse(raw);
  if (scope.noteIds.length) {
    const accessible = await ctx.db.query(`select id from notes where id=any($1::uuid[]) and org_id=$2 and data_mode=$3 and (expires_at is null or expires_at>now())`, [scope.noteIds, ctx.orgId, ctx.mode]);
    if (accessible.rowCount !== scope.noteIds.length) throw new AppError('VALIDATION_FAILED', '검색 자료가 만료되었거나 접근할 수 없습니다. 다시 검색해 주세요.');
  }
  const notes = scope.noteIds.length ? await getNotes(ctx, scope.noteIds) : [];
  const zh = chineseSearchCandidate(scope.query).text;
  const terms = [...new Set([scope.query, zh.replace(/推荐|攻略/g, '').trim(), ...scope.query.split(/\s+/).filter(word=>word.length>=2)].filter(Boolean))].slice(0,6);
  const matches = await Promise.all(terms.map(query => listSharedDictionary(ctx, {query: query.slice(0,100), entryType:'tag', pageSize:100})));
  const observed = notes.length ? await observedDictionary(ctx, notes) : [];
  const dictionary = [...new Map([...observed, ...matches.flatMap(r => r.items)].map(d => [d.id, d])).values()];
  return {scope, notes, dictionary, recommendations: recommendKeywords(scope.query, notes, dictionary)};
}
export const ExpandedKeyword = z.object({
  term: z.string().trim().min(2).max(40).regex(/^[\p{Script=Han}\p{Script=Latin}\p{N} ]+$/u).refine(term=>/\p{Script=Han}/u.test(term),'Chinese keyword required'),
  group: z.enum(['core','related','longTail']),
  meaningKo: z.string().trim().min(1).max(200),
  reasonKo: z.string().trim().min(1).max(200),
}).strict();
export const ExpandedKeywords = z.array(ExpandedKeyword).min(3).max(12).superRefine((items, ctx) => {
  if (new Set(items.map(t => canonicalTerm(t.term))).size !== items.length) ctx.addIssue({code:'custom',message:'Duplicate keyword'});
  for (const group of ['core','related','longTail']) if (!items.some(t => t.group === group)) ctx.addIssue({code:'custom',message:'Missing keyword group'});
});
/** AI supplies hypotheses and explanations; only server observations can supply evidence. */
export function mergeExpandedKeywords(base: ReturnType<typeof recommendKeywords>, raw: unknown) {
  const expanded = ExpandedKeywords.parse(raw);
  const items = new Map(base.items.map(item => [canonicalTerm(item.term), item]));
  for (const keyword of expanded) {
    const key = canonicalTerm(keyword.term);
    const existing = items.get(key);
    const item: KeywordRecommendation = existing
      ? {...existing, group:keyword.group, meaning:existing.meaning ?? keyword.meaningKo, suggested:true}
      : {term:keyword.term, group:keyword.group, dictionaryIds:[], meaning:keyword.meaningKo, cautions:[], noteCount:0, evidence:[], suggested:true};
    items.set(key, {...item, aiReason:keyword.reasonKo});
  }
  return {...base, items:[...items.values()]};
}

export const KeywordSourceSnapshot = z.object({
  requestId:z.string().uuid(),mode:z.enum(['mock','live']),query:z.string(),savedAt:z.string(),demo:z.boolean(),sampleSize:z.number().int().nonnegative(),
  entries:z.array(z.object({term:z.string(),group:z.enum(['core','related','longTail']),dictionaryIds:z.array(z.string().uuid()),meaning:z.string().nullable(),cautions:z.array(z.string()),noteCount:z.number().int().nonnegative(),evidence:z.array(z.object({noteId:z.string().uuid(),title:z.string()})),suggested:z.boolean(),aiReason:z.string().optional()})).max(8),
});
