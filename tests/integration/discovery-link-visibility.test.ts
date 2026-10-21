import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {discover,getNotes,storeNoteAccessLink,type Ctx} from '@xhs/core';
import {pool,asUser} from './db.ts';

const org=randomUUID(),student=randomUUID(),outsider=randomUUID();
const visible:string[]=[],hidden:string[]=[];
let unknown:string,expired:string,fallback:string,mock:string;
const user=<T>(uid:string,fn:(ctx:Ctx)=>Promise<T>,mode:'live'|'mock'='live')=>asUser(uid,db=>fn({db,uid,orgId:org,role:'student',mode}));
async function add(index:number,status?:'opened'|'not_found',mode:'live'|'mock'='live',isFallback=false){
 const pid=index.toString(16).padStart(24,'0');
 const id=(await pool.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance,is_fallback,published_at) values($1,'mock',$2,$3,$4,'可见性测试','{}',$5,now()) returning id`,[org,pid,mode,`https://www.xiaohongshu.com/explore/${pid}`,isFallback])).rows[0].id as string;
 if(status)await pool.query(`insert into note_link_checks(note_id,org_id,status,checked_at,method) values($1,$2,$3,now(),'browser_rednote')`,[id,org,status]);
 const db=await pool.connect();try{await storeNoteAccessLink(db,org,id,pid,`https://www.xiaohongshu.com/explore/${pid}?xsec_token=synthetic`);}finally{db.release();}
 return id;
}
beforeAll(async()=>{
 await pool.query(`insert into auth.users(id,email) values($1,$2),($3,$4)`,[student,student+'@demo.invalid',outsider,outsider+'@demo.invalid']);
 await pool.query(`insert into organizations(id,name) values($1,'visibility fixtures')`,[org]);
 await pool.query(`insert into memberships(org_id,user_id,role) values($1,$2,'student')`,[org,student]);
 for(let i=1;i<=52;i++)visible.push(await add(i,'opened'));
 for(let i=53;i<=71;i++)hidden.push(await add(i,'not_found'));
 unknown=await add(72);expired=await add(73,'opened');fallback=await add(74,'not_found','live',true);mock=await add(75,undefined,'mock');
 await pool.query(`update note_access_links set expires_at=now()-interval '1 second' where note_id=$1`,[expired]);
});
afterAll(async()=>{await pool.end();});

it('filters before pagination and retains every stored note and sharing link',async()=>{
 const first=await user(student,ctx=>discover(ctx,{}));
 expect(first.notes).toHaveLength(50);expect(first.nextCursor).not.toBeNull();
 const second=await user(student,ctx=>discover(ctx,{cursor:first.nextCursor!}));
 expect(second.notes).toHaveLength(2);expect(second.nextCursor).toBeNull();
 expect(new Set([...first.notes,...second.notes].map(n=>n.id))).toEqual(new Set(visible));
 expect(first.latestHot).toEqual([]);
 expect((await pool.query('select count(*)::int as n from notes where org_id=$1',[org])).rows[0].n).toBe(75);
 expect((await pool.query('select count(*)::int as n from note_access_links where org_id=$1',[org])).rows[0].n).toBe(75);
});
it('applies visibility to every stored search and sort including original-only results',async()=>{
 for(const sort of ['popular','saves','recent'] as const){
  const result=await user(student,ctx=>discover(ctx,{q:'可见性测试',original:'1',sort}));
  expect(result.notes).toHaveLength(50);
  expect(result.notes.every(n=>visible.includes(n.id)&&n.hasOriginalLink)).toBe(true);
 }
});
it('retains direct detail access while unverified, 404 and withdrawn links stay out of discovery',async()=>{
 const ids=[hidden[0]!,unknown,expired,fallback];
 expect((await user(student,ctx=>getNotes(ctx,ids))).map(n=>n.id)).toEqual(ids);
});
it('keeps mock discovery working without live verification',async()=>{
 expect((await user(student,ctx=>discover(ctx,{}),'mock')).notes.map(n=>n.id)).toEqual([mock]);
});
it('prevents non-members from reading checks and students from changing visibility',async()=>{
 expect(await asUser(outsider,async db=>(await db.query('select note_id from note_link_checks where org_id=$1',[org])).rows)).toEqual([]);
 await expect(asUser(student,db=>db.query(`update note_link_checks set status='opened' where note_id=$1`,[hidden[0]]))).rejects.toThrow(/permission denied/);
 await expect(asUser(student,db=>db.query(`delete from note_link_checks where note_id=$1`,[hidden[0]]))).rejects.toThrow(/permission denied/);
 expect((await user(outsider,ctx=>discover(ctx,{}))).notes).toEqual([]);
});
