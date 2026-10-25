import {it,expect,beforeAll,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {pool,asUser} from './db.ts';
import {learningHome,saveWriting,getWriting,type Ctx} from '@xhs/core';
const org=randomUUID(),a=randomUUID(),b=randomUUID();
beforeAll(async()=>{await pool.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[a,a+'@demo.invalid',b,b+'@demo.invalid']);await pool.query("insert into organizations(id,name) values($1,'home fixture')",[org]);await pool.query("insert into memberships(org_id,user_id,role) values($1,$2,'student'),($1,$3,'student')",[org,a,b]);});
afterAll(()=>pool.end());
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>)=>asUser(uid,db=>fn({db,uid,orgId:org,mode:'mock',role:'student'}));
it('shows recent private work only to its owner and keeps the Korean review marker',async()=>{
 const id=randomUUID();await user(a,ctx=>saveWriting(ctx,{id,revision:0,title:'최근 글',cover:'',body:'正文',meaningKo:'확인본',meaningReviewedFor:'review-key',tags:[],entryIds:[]}));
 expect((await user(a,ctx=>getWriting(ctx,id))).draft.meaningReviewedFor).toBe('review-key');
 const result=await user(a,learningHome);expect(result.recent[0]?.id).toBe(id);expect((await user(b,learningHome)).recent).toEqual([]);
});
