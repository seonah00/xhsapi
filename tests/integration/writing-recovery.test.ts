import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {savePersonalDictionary,personalDictionaryEntries,editPersonalDictionary,getTemporaryWriting,saveTemporaryWriting,saveWriting,type Ctx} from '@xhs/core';
import {pool,asUser} from './db.ts';
const org=randomUUID(),a=randomUUID(),b=randomUUID(),manager=randomUUID();
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>,mode:'mock'|'live'='mock')=>asUser(uid,db=>fn({db,uid,orgId:org,mode,role:uid===manager?'org_admin':'student'}));
beforeAll(async()=>{
 await pool.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[a,a+'@demo.invalid',b,b+'@demo.invalid',manager,manager+'@demo.invalid']);
 await pool.query("insert into organizations(id,name) values($1,'working copy fixture')",[org]);
 await pool.query("insert into memberships(org_id,user_id,role) values($1,$2,'student'),($1,$3,'student'),($1,$4,'org_admin')",[org,a,b,manager]);
});
afterAll(()=>pool.end());
it('edits private meanings, classification, favorite, usage and examples without overwriting custom notes on repeat save',async()=>{
 const source={kind:'manual',entryType:'expression',term:'记录日常',meaning:'기존 뜻'};
 const id=await user(a,ctx=>savePersonalDictionary(ctx,source));
 const edit={id,revision:1,meaning:'일상을 기록하다',folder:'일상',favorite:true,note:'내 메모',usage:'소소한 일상 소개',examples:[{zh:'记录今天的小事。',ko:'오늘의 작은 일을 기록해요.'}]};
 await user(a,ctx=>editPersonalDictionary(ctx,edit));
 await expect(user(a,ctx=>editPersonalDictionary(ctx,edit))).rejects.toMatchObject({code:'CONFLICT'});
 await expect(user(b,ctx=>editPersonalDictionary(ctx,{...edit,revision:2}))).rejects.toMatchObject({code:'CONFLICT'});
 await expect(user(manager,ctx=>editPersonalDictionary(ctx,{...edit,revision:2}))).rejects.toThrow();
 await user(a,ctx=>savePersonalDictionary(ctx,source));
 const [saved]=await user(a,ctx=>personalDictionaryEntries(ctx,undefined,'소소한'));
 expect(saved).toMatchObject({...edit,revision:2});
 expect(await user(a,personalDictionaryEntries,'live')).toEqual([]);
 expect(await user(b,personalDictionaryEntries)).toEqual([]);
});
it('keeps temporary content private, rejects stale windows and preserves tombstones after discard',async()=>{
 const content={id:randomUUID(),revision:0,title:'未完成',cover:'',body:'临时内容',meaningKo:'임시',tags:[],entryIds:[]};
 expect(await user(a,ctx=>saveTemporaryWriting(ctx,{scope:'new',version:0,content}))).toEqual({version:1});
 expect((await user(a,ctx=>getTemporaryWriting(ctx,'new'))).content).toEqual({...content,meaningReviewedFor:'',learningNotes:''});
 for(const uid of [b,manager])expect((await user(uid,ctx=>getTemporaryWriting(ctx,'new'))).content).toBeNull();
 expect((await user(a,ctx=>getTemporaryWriting(ctx,'new'),'live')).content).toBeNull();
 await expect(user(a,ctx=>saveTemporaryWriting(ctx,{scope:'new',version:0,content}))).rejects.toMatchObject({code:'CONFLICT'});
 await user(a,ctx=>saveWriting(ctx,content));
 await expect(user(a,ctx=>saveTemporaryWriting(ctx,{scope:'new',version:1,content}))).rejects.toMatchObject({code:'CONFLICT'});
 await user(a,ctx=>saveTemporaryWriting(ctx,{scope:'new',version:1,content:null}));
 await expect(user(a,ctx=>saveTemporaryWriting(ctx,{scope:'new',version:1,content}))).rejects.toMatchObject({code:'CONFLICT'});
 expect((await user(a,ctx=>getTemporaryWriting(ctx,'new'))).content).toBeNull();
});
it('ignores expired working-copy payloads without resetting their concurrency version',async()=>{
 const content={id:randomUUID(),revision:0,title:'旧稿',cover:'',body:'旧内容',meaningKo:'',tags:[],entryIds:[]};
 const scope=`draft:${content.id}`;
 await user(a,ctx=>saveTemporaryWriting(ctx,{scope,version:0,content}));
 await pool.query("update writing_temporary set updated_at=now()-interval '31 days' where scope=$1",[scope]);
 expect(await user(a,ctx=>getTemporaryWriting(ctx,scope))).toMatchObject({content:null,version:1});
});
