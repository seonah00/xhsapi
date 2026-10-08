import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { importDictionaryPlan } from '../../packages/core/src/dictionary-plan.ts';
import { listAccounts, createAccount, getPlan, saveDraft, stageDictionaryImport, reviewDictionaryImport, publishDictionaryImport, listSharedDictionary, type Ctx } from '@xhs/core';
import { asUser, ORG1, ORG2, U } from './db.ts';
const run = <T>(uid: string, fn: (ctx: Ctx) => Promise<T>, orgId = ORG1) => asUser(uid, db => fn({db,uid,orgId,role:uid===U.admin?'org_admin':'student',mode:'mock'}));

describe('dictionary private plan import', () => {
  it('saves selected content and public meanings, is idempotent, preserves source on autosave and isolates owners', async () => {
    const key = randomUUID();
    await run(U.admin, async ctx => {
      const batch = await stageDictionaryImport(ctx, { label:'plan test', payload:{tags:[{id:key,term:'测试散步',meaning:'테스트 산책',categories:['일상'],cautions:['실제 촬영 전 확인']}],expressions:[]} });
      await reviewDictionaryImport(ctx, batch, true);
      await publishDictionaryImport(ctx, batch, true);
    });
    const entries = await run(U.studentA, ctx => listSharedDictionary(ctx, {query:'测试散步'}));
    const accountId = await run(U.studentA, async ctx => (await listAccounts(ctx))[0]?.id ?? createAccount(ctx, {displayName:'사전 기획 테스트',topics:['daily-life'],mainTopic:'daily-life',audience:'산책',goals:['record_life'],tone:'plain',formats:['vlog'],chineseLevel:'beginner',showFace:false,useVoice:false}));
    const input = {requestId:randomUUID(),accountId,name:'사전 산책 기획',entryIds:[entries.items[0]!.id],notes:'방문 예정이며 아직 경험하지 않음',mode:'plan',disclosure:'none',content:{title:'周末散步计划',cover:'周末去散步',body:'计划去公园散步',meaningKo:'공원 산책 계획',tags:['测试散步']}};
    const id = await run(U.studentA, ctx => importDictionaryPlan(ctx,input));
    expect(await run(U.studentA, ctx => importDictionaryPlan(ctx,input))).toBe(id);
    const plan = await run(U.studentA, ctx => getPlan(ctx,id));
    expect(plan.draft.content.cover).toBe(input.content.cover);
    expect(plan.draft.facts.confirmedFacts).toEqual([]);
    expect(plan.draft.facts.shootableScenes).toEqual([]);
    expect(plan.dictionarySource?.entries[0]?.meaning).toBe('테스트 산책');
    expect(plan.versions[0]?.content.title).toBe(input.content.title);
    await run(U.studentA, ctx => saveDraft(ctx,id,{...plan.draft,content:{...plan.draft.content,cover:'새 표지'}},plan.revision));
    expect((await run(U.studentA,ctx=>getPlan(ctx,id))).dictionarySource?.requestId).toBe(input.requestId);
    await expect(run(U.studentB,ctx=>getPlan(ctx,id))).rejects.toThrow();
    await expect(run(U.studentB,ctx=>importDictionaryPlan(ctx,{...input,requestId:randomUUID()}))).rejects.toThrow();
    await expect(run(U.studentA,ctx=>importDictionaryPlan(ctx,{...input,requestId:randomUUID(),entryIds:[randomUUID()]}))).rejects.toThrow();
    await expect(run(U.studentC,ctx=>importDictionaryPlan(ctx,{...input,requestId:randomUUID()}),ORG2)).rejects.toThrow();
  });
});
