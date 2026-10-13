import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createQuote, reserveJob, runJob, languageJobResult, prepareLanguageAi, type Ctx, type Runner } from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { ORG1, U, pool, asUser } from './db.ts';
const service:Runner=async fn=>{const db=await pool.connect();try{await db.query('begin');const out=await fn(db);await db.query('commit');return out;}catch(e){await db.query('rollback');throw e;}finally{db.release();}};
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>)=>asUser(uid,db=>fn({db,uid,orgId:ORG1,mode:'mock',role:'student'}));
afterAll(()=>pool.end());
it('queues a translation through the existing ledger and isolates results by owner',async()=>{
 const scope={task:'translate' as const,query:'비오는 날 실내에서 아이와 놀 곳'};
 const quote=await user(U.studentB,ctx=>createQuote(ctx,service,'query_expansion',scope));
 const args={quoteId:quote.id,operation:'query_expansion' as const,scope,route:'test/language',idempotencyKey:randomUUID(),jobKind:'query_expansion' as const,dedupeKey:quote.id,inputRef:scope};
 const first=await user(U.studentB,ctx=>reserveJob(ctx,args));
 expect((await user(U.studentB,ctx=>reserveJob(ctx,args))).jobId).toBe(first.jobId);
 expect(await runJob({service,provider:new MockXhsProvider()},first.jobId,'language-test')).toMatchObject({state:'succeeded'});
 expect((await user(U.studentB,ctx=>languageJobResult(ctx,first.jobId)))?.result_ref?.demo).toBe(true);
 expect(await user(U.studentA,ctx=>languageJobResult(ctx,first.jobId))).toBeNull();
 expect((await pool.query('select status from usage_ledger where job_id=$1',[first.jobId])).rows[0].status).toBe('demo');
});
it('rejects inaccessible evidence rather than accepting client supplied text',async()=>{
 await expect(user(U.studentB,ctx=>prepareLanguageAi(ctx,{task:'interpret',noteIds:[randomUUID()]}))).rejects.toThrow();
 await expect(user(U.studentB,ctx=>prepareLanguageAi(ctx,{task:'interpret',noteIds:[],body:'fabricated'}))).rejects.toThrow();
});
it('queues general expansion and prevents another user from importing its result',async()=>{
 const scope={task:'expand' as const,query:'저당 도시락',noteIds:[]};
 const quote=await user(U.studentB,ctx=>createQuote(ctx,service,'query_expansion',scope));
 const {jobId}=await user(U.studentB,ctx=>reserveJob(ctx,{quoteId:quote.id,operation:'query_expansion',scope,route:'test/expand',idempotencyKey:randomUUID(),jobKind:'query_expansion',dedupeKey:quote.id,inputRef:scope}));
 expect(await runJob({service,provider:new MockXhsProvider()},jobId,'expand-test')).toMatchObject({state:'succeeded'});
 const {keywordPlanCandidates}=await import('@xhs/core');
 const own=await user(U.studentB,ctx=>keywordPlanCandidates(ctx,{query:scope.query,noteIds:[],jobId}));
 expect(own.result.items.some(k=>k.term==='雨天亲子旅行')).toBe(true);
 await expect(user(U.studentA,ctx=>keywordPlanCandidates(ctx,{query:scope.query,noteIds:[],jobId}))).rejects.toThrow();
});
