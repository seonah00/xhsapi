import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {savePersonalDictionary,personalDictionaryEntries,archivePersonalDictionary,saveWriting,getWriting,listWriting,previewDictionaryAi,DICTIONARY_AI_MODEL,type Ctx,type DictionaryAiConfig} from '@xhs/core';
import {pool,asUser} from './db.ts';
const org=randomUUID(),a=randomUUID(),b=randomUUID(),admin=randomUUID();
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>,mode:'mock'|'live'='mock')=>asUser(uid,db=>fn({db,uid,orgId:org,mode,role:uid===admin?'org_admin':'student'}));
const config:DictionaryAiConfig={enabled:false,sessionSecret:'test-private-writing-signature-long-enough',model:DICTIONARY_AI_MODEL,userMonthlyLimit:90,globalMonthlyUsdLimit:5};
beforeAll(async()=>{
 await pool.query(`insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)`,[a,a+'@demo.invalid',b,b+'@demo.invalid',admin,admin+'@demo.invalid']);
 await pool.query(`insert into organizations(id,name) values($1,'private writing fixture')`,[org]);
 await pool.query(`insert into memberships(org_id,user_id,role) values($1,$2,'student'),($1,$3,'student'),($1,$4,'org_admin')`,[org,a,b,admin]);
});
afterAll(()=>pool.end());
let entryId:string;let draftId:string;
it('deduplicates private terms, never shares them with other users/admin/modes, and restores hidden entries',async()=>{
 const source={kind:'manual',entryType:'tag',term:'防晒',meaning:'자외선 차단'};
 entryId=await user(a,ctx=>savePersonalDictionary(ctx,source));
 expect(await user(a,ctx=>savePersonalDictionary(ctx,source))).toBe(entryId);
 expect(await user(b,personalDictionaryEntries)).toHaveLength(0);
 expect(await user(admin,personalDictionaryEntries)).toHaveLength(0);
 expect(await user(a,personalDictionaryEntries,'live')).toHaveLength(0);
 await user(a,ctx=>archivePersonalDictionary(ctx,entryId));expect(await user(a,personalDictionaryEntries)).toHaveLength(0);
 expect(await user(a,ctx=>savePersonalDictionary(ctx,source))).toBe(entryId);
 await expect(user(a,ctx=>savePersonalDictionary(ctx,{kind:'observed',source:{query:'防晒',noteIds:[]},term:'防晒'}))).rejects.toThrow();
});
it('builds AI preview from owned private entries only, without calling providers',async()=>{
 const input={entryIds:[entryId],category:'뷰티' as const,mode:'record' as const,notes:'직접 사용한 메모',tone:'calm' as const,disclosure:'none' as const,experienceConfirmed:true};
 const preview=await user(a,ctx=>previewDictionaryAi(ctx,input,config));
 expect(preview.context.input.tags[0]?.term).toBe('防晒');
 await expect(user(b,ctx=>previewDictionaryAi(ctx,input,config))).rejects.toThrow();
});
it('saves independent writing and immutable versions; rejects stale and foreign edits',async()=>{
 draftId=randomUUID();const input={id:draftId,revision:0,title:'我的记录',cover:'今日记录',body:'我自己的内容',tags:['防晒'],entryIds:[entryId]};
 expect((await user(a,ctx=>saveWriting(ctx,input))).revision).toBe(1);
 const edits=await Promise.allSettled([user(a,ctx=>saveWriting(ctx,{...input,revision:1,body:'第二版'})),user(a,ctx=>saveWriting(ctx,{...input,revision:1,body:'冲突版本'}))]);
 expect(edits.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const saved=await user(a,ctx=>getWriting(ctx,draftId));expect(saved.versions).toHaveLength(2);expect(saved.versions[1]?.snapshot.body).toBe(input.body);
 expect(saved.draft.entries[0]?.term).toBe('防晒');
 await expect(user(b,ctx=>getWriting(ctx,draftId))).rejects.toThrow();
 await expect(user(admin,ctx=>getWriting(ctx,draftId))).rejects.toThrow();
 expect(await user(b,listWriting)).toHaveLength(0);
 expect((await asUser(b,db=>db.query('select * from writing_versions where draft_id=$1',[draftId]))).rows).toHaveLength(0);
 await expect(asUser(a,db=>db.query(`update writing_versions set snapshot='{}' where draft_id=$1`,[draftId]))).rejects.toThrow();
 await user(a,ctx=>archivePersonalDictionary(ctx,entryId));
 expect((await user(a,ctx=>getWriting(ctx,draftId))).draft.entries[0]?.term).toBe('防晒');
});
