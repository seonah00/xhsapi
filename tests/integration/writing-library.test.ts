import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {saveWriting,getWriting,writingPage,personalDictionaryPage,savePersonalDictionary,archivePersonalDictionary,restoreWritingVersion,duplicateWriting,setWritingArchived,saveTemporaryWriting,type Ctx} from '@xhs/core';
import {pool,asUser} from './db.ts';
const org=randomUUID(),a=randomUUID(),b=randomUUID(),admin=randomUUID();
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>,mode:'mock'|'live'='mock')=>asUser(uid,db=>fn({db,uid,orgId:org,mode,role:uid===admin?'org_admin':'student'}));
beforeAll(async()=>{
 await pool.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[a,a+'@demo.invalid',b,b+'@demo.invalid',admin,admin+'@demo.invalid']);
 await pool.query("insert into organizations(id,name) values($1,'private library fixture')",[org]);
 await pool.query("insert into memberships(org_id,user_id,role) values($1,$2,'student'),($1,$3,'student'),($1,$4,'org_admin')",[org,a,b,admin]);
 await pool.query(`insert into personal_dictionary(org_id,owner_user_id,data_mode,entry_type,term,canonical_term,meaning,source_kind,saved_at,folder,favorite)
 select $1,$2,'mock','expression','分页词'||n,'分页词'||n,'페이지 예시','manual',now()-n*interval '1 minute',case when n=205 then '이전 분류' else '일상' end,n=205 from generate_series(1,205)n`,[org,a]);
 await pool.query(`insert into writing_drafts(id,org_id,owner_user_id,data_mode,title,body,updated_at) select gen_random_uuid(),$1,$2,'mock','分页稿'||n,case when n=120 then '远处旧稿' else '页面内容' end,now()-n*interval '1 minute' from generate_series(1,120)n`,[org,a]);
});
afterAll(()=>pool.end());
it('paginates beyond former caps with stable filters, total counts and isolation',async()=>{
 const seen=new Set<string>();for(let page=1;page<=18;page++){const result=await user(a,ctx=>personalDictionaryPage(ctx,{q:'分页词',page}));expect(result.total).toBe(205);for(const entry of result.items){expect(seen.has(entry.id)).toBe(false);seen.add(entry.id);}}expect(seen.size).toBe(205);
 expect((await user(a,ctx=>personalDictionaryPage(ctx,{folder:'이전 분류',favorite:true,page:999}))).items[0]?.term).toBe('分页词205');
 const last=await user(a,ctx=>writingPage(ctx,{q:'分页稿',page:12}));expect(last.total).toBe(120);expect(last.page).toBe(12);expect(last.items).toHaveLength(10);
 expect((await user(a,ctx=>writingPage(ctx,{q:'远处旧稿'}))).items).toHaveLength(1);
 expect((await user(a,ctx=>writingPage(ctx,{q:'%',page:999}))).total).toBe(0);
 for(const uid of [b,admin]){expect((await user(uid,writingPage)).total).toBe(0);expect((await user(uid,personalDictionaryPage)).total).toBe(0);}
 expect((await user(a,writingPage,'live')).total).toBe(0);
});
it('restores as a new immutable version, rejects unsaved working copies, and duplicates archived items independently',async()=>{
 const entry=await user(a,ctx=>savePersonalDictionary(ctx,{kind:'manual',entryType:'tag',term:'旧词',meaning:'이전 뜻'}));
 const id=randomUUID(),input={id,revision:0,title:'版本测试',cover:'表纸',body:'第一版',meaningKo:'원본',tags:['旧词'],entryIds:[entry]};
 await user(a,ctx=>saveWriting(ctx,input));await user(a,ctx=>saveWriting(ctx,{...input,revision:1,body:'第二版'}));
 await user(a,ctx=>saveTemporaryWriting(ctx,{scope:`draft:${id}`,version:0,content:{...input,revision:2,body:'临时版'}}));
 await expect(user(a,ctx=>restoreWritingVersion(ctx,id,2,1))).rejects.toMatchObject({code:'CONFLICT'});
 await user(a,ctx=>saveTemporaryWriting(ctx,{scope:`draft:${id}`,version:1,content:null}));await user(a,ctx=>archivePersonalDictionary(ctx,entry));
 expect((await user(a,ctx=>restoreWritingVersion(ctx,id,2,1))).revision).toBe(3);
 const restored=await user(a,ctx=>getWriting(ctx,id));expect(restored.draft.body).toBe('第一版');expect(restored.versions[1]?.snapshot.body).toBe('第二版');expect(restored.versions[0]?.restored_from).toBe(1);expect(restored.draft.entries[0]?.term).toBe('旧词');
 await expect(user(a,ctx=>restoreWritingVersion(ctx,id,2,1))).rejects.toMatchObject({code:'CONFLICT'});
 const copy=await user(a,ctx=>duplicateWriting(ctx,id,3));expect(copy.id).not.toBe(id);expect((await user(a,ctx=>getWriting(ctx,copy.id))).versions).toHaveLength(1);
 await user(a,ctx=>setWritingArchived(ctx,copy.id,1,true));expect((await user(a,ctx=>writingPage(ctx,{q:'版本测试',state:'archived'}))).items).toHaveLength(1);
 await expect(user(a,ctx=>saveWriting(ctx,{...input,id:copy.id,revision:1,entryIds:[]}))).rejects.toMatchObject({code:'CONFLICT'});
 await user(a,ctx=>setWritingArchived(ctx,copy.id,1,false));expect((await user(a,ctx=>getWriting(ctx,copy.id))).draft.archivedAt).toBeNull();
 await expect(user(b,ctx=>duplicateWriting(ctx,id,3))).rejects.toMatchObject({code:'NOT_FOUND'});await expect(user(admin,ctx=>restoreWritingVersion(ctx,id,3,1))).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('exposes older than 50 versions and preserves ordering when paging',async()=>{
 const id=randomUUID();for(let i=0;i<52;i++)await user(a,ctx=>saveWriting(ctx,{id,revision:i,title:'长历史',cover:'',body:'版本'+(i+1),tags:[],entryIds:[]}));
 const last=await user(a,ctx=>getWriting(ctx,id,6));expect(last.versionPaging.total).toBe(52);expect(last.versions.map(v=>v.revision)).toEqual([2,1]);
 await user(a,ctx=>restoreWritingVersion(ctx,id,52,1));expect((await user(a,ctx=>getWriting(ctx,id))).draft.body).toBe('版本1');
});
