import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@xhs/domain';
import { verifyKeywordCandidates,keywordVerificationResults,setAutoSearchPolicy,runJob,type Ctx,type Runner } from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { pool,asUser } from './db.ts';
const org=randomUUID(),admin=randomUUID(),student=randomUUID(),other=randomUUID();
const service:Runner=async fn=>{const db=await pool.connect();try{await db.query('begin');const result=await fn(db);await db.query('commit');return result;}catch(e){await db.query('rollback');throw e;}finally{db.release();}};
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>)=>asUser(uid,db=>fn({db,uid,orgId:org,mode:'mock',role:uid===admin?'org_admin':'student'}));
const env=loadEnv({});
const input={source:{query:'防晒霜推荐',noteIds:[]},terms:['防晒霜','防晒测评','敏感肌防晒霜推荐']};
beforeAll(async()=>{
 await pool.query(`insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)`,[admin,admin+'@demo.invalid',student,student+'@demo.invalid',other,other+'@demo.invalid']);
 await pool.query(`insert into organizations(id,name) values($1,'keyword fixture')`,[org]);
 await pool.query(`insert into memberships(org_id,user_id,role) values($1,$2,'org_admin'),($1,$3,'student'),($1,$4,'student')`,[org,admin,student,other]);
});
afterAll(()=>pool.end());
const policy=(perStudent:number)=>user(admin,ctx=>setAutoSearchPolicy(ctx,{enabled:true,perStudent,perMonth:30,expiresAt:new Date(Date.now()+86400000).toISOString()}));
it('rolls back the whole batch when any candidate exceeds the limit',async()=>{
 await policy(2);
 await expect(user(student,ctx=>verifyKeywordCandidates(ctx,service,input,env))).rejects.toMatchObject({code:'RATE_LIMITED'});
 expect((await pool.query('select count(*)::int as n from app_jobs where org_id=$1',[org])).rows[0].n).toBe(0);
});
it('deduplicates batches, validates candidates and isolates results',async()=>{
 await policy(10);
 await expect(user(student,ctx=>verifyKeywordCandidates(ctx,service,{...input,terms:['不在候选中']},env))).rejects.toThrow();
 const ids=await user(student,ctx=>verifyKeywordCandidates(ctx,service,input,env));
 expect(await user(student,ctx=>verifyKeywordCandidates(ctx,service,input,env))).toEqual(ids);
 expect(ids).toHaveLength(3);
 await expect(user(other,ctx=>keywordVerificationResults(ctx,service,ids))).rejects.toMatchObject({code:'NOT_FOUND'});
 const jobs=(await pool.query('select job_id from search_requests where id=any($1::uuid[])',[ids])).rows;
 for(const job of jobs) await runJob({service,provider:new MockXhsProvider(),env},job.job_id,'keyword-fixture');
 const result=await user(student,ctx=>keywordVerificationResults(ctx,service,ids));
 expect(result.every(r=>r.state==='succeeded')).toBe(true);
 expect(result.every(r=>r.evidence.noteCount===0)).toBe(true);
 await pool.query("update app_jobs set state='unknown_outcome' where id=$1",[jobs[0].job_id]);
 expect(await user(student,ctx=>verifyKeywordCandidates(ctx,service,input,env))).toEqual(ids);
 expect((await user(student,ctx=>keywordVerificationResults(ctx,service,ids))).some(r=>r.state==='unknown_outcome')).toBe(true);
});
