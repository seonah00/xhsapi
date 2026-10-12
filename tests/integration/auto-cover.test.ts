import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { loadEnv } from '@xhs/domain';
import { MockXhsProvider } from '@xhs/providers';
import { connectOriginalNoteLink, originalNoteLink, requestAutoCover, autoCoverStatus, setAutoCoverPolicy, runJob, type Ctx, type Runner } from '@xhs/core';
import { pool, asUser } from './db.ts';

const org = randomUUID(), admin = randomUUID(), student = randomUUID(), outsider = randomUUID();
const env = loadEnv({});
let ids: string[], job: string;
const service: Runner = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; } catch(e) { await c.query('rollback'); throw e; } finally { c.release(); } };
const user = <T>(uid: string, fn: (ctx: Ctx) => Promise<T>) => asUser(uid, db => fn({db,uid,orgId:org,role:uid===admin?'org_admin':'student',mode:'mock'}));
const policy = {enabled:true,perMonth:2,maxUsd:'0.30',expiresAt:new Date(Date.now()+86400_000).toISOString()};
beforeAll(async () => {
  await pool.query(`insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)`, [admin,`${admin}@demo.invalid`,student,`${student}@demo.invalid`,outsider,`${outsider}@demo.invalid`]);
  await pool.query(`insert into organizations(id,name) values($1,'cover maintenance fixture')`, [org]);
  await pool.query(`insert into memberships(org_id,user_id,role) values($1,$2,'org_admin'),($1,$3,'student')`, [org,admin,student]);
  ids = [];
  for (const n of ['a','b','c']) ids.push((await pool.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance) values($1,'mock',$2,'mock',$3,'fixture','{}') returning id`, [org,n.repeat(24),`https://www.xiaohongshu.com/explore/${n.repeat(24)}`])).rows[0].id);
});
afterAll(async () => { await pool.end(); });

it('requires administrator sponsorship and active membership', async () => {
  expect(await user(student,ctx=>requestAutoCover(ctx,service,ids,env))).toBeNull();
  await expect(user(student,ctx=>setAutoCoverPolicy(ctx,policy))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(user(outsider,ctx=>requestAutoCover(ctx,service,ids,env))).rejects.toMatchObject({code:'FORBIDDEN'});
  await user(admin,ctx=>setAutoCoverPolicy(ctx,policy));
  expect(await user(student,ctx=>requestAutoCover(ctx,service,[randomUUID()],env))).toBeNull();
});
it('serializes duplicate failures, counts notes against the monthly cap and hides private jobs', async () => {
  const result = await Promise.all([user(student,ctx=>requestAutoCover(ctx,service,ids,env)),user(student,ctx=>requestAutoCover(ctx,service,ids,env))]);
  expect(result.filter(Boolean)).toHaveLength(1);
  job = result.find(Boolean)!;
  const row = (await pool.query(`select input_ref,owner_user_id from app_jobs where id=$1`,[job])).rows[0];
  expect(row.input_ref.noteIds).toEqual(ids.slice(0,2));
  expect(row.owner_user_id).toBe(admin);
  expect(await user(student,ctx=>requestAutoCover(ctx,service,[ids[2]],env))).toBeNull();
  expect(await user(student,ctx=>autoCoverStatus(ctx,service,job))).toEqual({state:'queued'});
  expect(await user(outsider,ctx=>autoCoverStatus(ctx,service,job))).toBeNull();
});
it('rechecks policy before worker execution', async () => {
  await user(admin,ctx=>setAutoCoverPolicy(ctx,{enabled:false}));
  expect(await runJob({service,env,provider:new MockXhsProvider()},job,'fixture-worker')).toMatchObject({state:'failed',errorCode:'AUTO_COVER_STOPPED',sent:false});
});
it('quarantines unknown results beyond cooldown and refuses expired sponsorship', async () => {
  await user(admin,ctx=>setAutoCoverPolicy(ctx,{...policy,perMonth:20}));
  await pool.query(`update app_jobs set state='unknown_outcome',created_at=now()-interval '48 hours' where id=$1`,[job]);
  expect(await user(student,ctx=>requestAutoCover(ctx,service,ids.slice(0,2),env))).toBeNull();
  const next = await user(student,ctx=>requestAutoCover(ctx,service,[ids[2]],env));
  expect(next).toBeTruthy();
  await pool.query(`update app_jobs set state='succeeded' where id=$1`,[next]);
  expect(await user(student,ctx=>requestAutoCover(ctx,service,[ids[2]],env))).toBeNull();
  await pool.query(`update organizations set settings=jsonb_set(settings,'{auto_cover,expiresAt}',to_jsonb($2::text)) where id=$1`,[org,new Date(Date.now()-60000).toISOString()]);
  expect(await user(student,ctx=>requestAutoCover(ctx,service,ids,env))).toBeNull();
});

it('connects only administrator-supplied matching public original links without exposing them across organizations',async()=>{
 const link=`https://www.xiaohongshu.com/explore/${'a'.repeat(24)}?xsec_token=synthetic`;
 await expect(user(student,ctx=>connectOriginalNoteLink(ctx,service,ids[0]!,link))).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(user(admin,ctx=>connectOriginalNoteLink(ctx,service,ids[1]!,link))).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 await expect(user(admin,ctx=>connectOriginalNoteLink(ctx,service,ids[0]!,link.split('?')[0]))).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 await user(admin,ctx=>connectOriginalNoteLink(ctx,service,ids[0]!,link));
 expect(await user(student,ctx=>originalNoteLink(ctx,service,ids[0]!))).toBe(link);
 expect(await user(outsider,ctx=>originalNoteLink(ctx,service,ids[0]!))).toBeNull();
});
