import { z } from 'zod';
import { AppError, canonicalTerm } from '@xhs/domain';
import type { Ctx } from './context.ts';
import { KeywordScope, keywordResearch, mergeExpandedKeywords } from './keyword-research.ts';
import { languageJobResult } from './search-language-ai.ts';
import { createPlan, getPlan, saveDraft, saveVersion, FactSheet } from './plans.ts';

export const KeywordPlanSource = KeywordScope.extend({jobId:z.string().uuid().optional()}).strict();
export async function keywordPlanCandidates(ctx:Ctx, raw:unknown) {
  const source=KeywordPlanSource.parse(raw);
  if(source.jobId) {
    const job=await languageJobResult(ctx,source.jobId);
    if(job?.state!=='succeeded'||job.input_ref.task!=='expand'||!job.result_ref?.output.keywords) throw new AppError('VALIDATION_FAILED','완료된 본인의 키워드 확장 결과를 선택하세요.');
    const research=await keywordResearch(ctx,{query:job.input_ref.query,noteIds:job.input_ref.noteIds});
    return {source:{...research.scope,jobId:source.jobId},result:mergeExpandedKeywords(research.recommendations,job.result_ref.output.keywords),demo:job.result_ref.demo};
  }
  const research=await keywordResearch(ctx,{query:source.query,noteIds:source.noteIds});
  return {source:research.scope,result:research.recommendations,demo:ctx.mode==='mock'};
}
export const KeywordPlanInput=z.object({
  source:KeywordPlanSource,requestId:z.string().uuid(),accountId:z.string().uuid(),name:z.string().trim().min(1).max(200),
  selected:z.array(z.string().trim().min(2).max(40)).min(1).max(8),
  facts:FactSheet,
}).strict();
export async function importKeywordPlan(ctx:Ctx, raw:unknown) {
  const input=KeywordPlanInput.parse(raw);
  await ctx.db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`keyword-plan:${ctx.orgId}:${ctx.uid}:${ctx.mode}:${input.requestId}`]);
  const existing=(await ctx.db.query(`select id,deleted_at from plans where org_id=$1 and owner_user_id=$2 and draft_json->'keywordSource'->>'requestId'=$3 and draft_json->'keywordSource'->>'mode'=$4`,[ctx.orgId,ctx.uid,input.requestId,ctx.mode])).rows[0];
  if(existing) {
    if(existing.deleted_at) throw new AppError('CONFLICT','이미 가져온 기획이 휴지통에 있습니다.');
    return existing.id as string;
  }
  const research=await keywordPlanCandidates(ctx,input.source);
  const selected=[...new Set(input.selected.map(canonicalTerm))];
  const entries=selected.map(term=>research.result.items.find(item=>canonicalTerm(item.term)===term));
  if(entries.some(e=>!e)) throw new AppError('VALIDATION_FAILED','선택한 키워드를 현재 자료에서 확인할 수 없습니다. 후보를 다시 선택하세요.');
  const keywords=entries.map(e=>e!);
  const planId=await createPlan(ctx,{accountId:input.accountId,title:input.name});
  const plan=await getPlan(ctx,planId);
  const saved=await saveDraft(ctx,planId,{content:{tags:keywords.map(e=>e.term),intent:`검색 주제: ${research.source.query}\n선택 키워드를 참고해 본인의 사실로 본문·영상 스크립트를 작성합니다.`.slice(0,500)},facts:{...input.facts,unknownFacts:[...input.facts.unknownFacts,'추천 키워드는 본인의 경험·제품 효능을 증명하지 않습니다.'].slice(0,20)}},plan.revision);
  await saveVersion(ctx,planId,saved.revision);
  const snapshot={requestId:input.requestId,mode:ctx.mode,query:research.source.query,savedAt:new Date().toISOString(),demo:research.demo,sampleSize:research.result.sampleSize,entries:keywords};
  await ctx.db.query(`update plans set draft_json=draft_json||jsonb_build_object('keywordSource',$2::jsonb) where id=$1 and org_id=$3 and owner_user_id=$4`,[planId,JSON.stringify(snapshot),ctx.orgId,ctx.uid]);
  return planId;
}
