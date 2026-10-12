import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createQuote,reserveJob,runJob,originalNoteLink,requestAutoSearch,setAutoSearchPolicy,type Ctx,type Runner} from '@xhs/core';
import {MockXhsProvider} from '@xhs/providers';
import {loadEnv} from '@xhs/domain';
import {pool} from './db.ts';
const org=randomUUID(),uid=randomUUID(),note=randomUUID(),pid='c'.repeat(24);
const env={...loadEnv({}),APP_DATA_MODE:'live' as const,LIVE_PROVIDER_CALLS_ENABLED:true,APIFY_ENABLED:true,AUTO_REFRESH_ENABLED:true,APIFY_SEARCH_BUILD:'1.2.3',APIFY_TOKEN:'synthetic'};
const service:Runner=async fn=>{const db=await pool.connect();try{await db.query('begin');const r=await fn(db);await db.query('commit');return r;}catch(e){await db.query('rollback');throw e;}finally{db.release();}};
const user=<T>(fn:(ctx:Ctx)=>Promise<T>)=>service(async db=>{await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[uid]);await db.query('set local role authenticated');return fn({db,orgId:org,uid,role:'org_admin',mode:'live'});});
const scope={source:'apify',query:'合成搜索',targetCount:50};
async function enqueue(){const q=await user(ctx=>createQuote(ctx,service,'provider_search',scope,{env}));expect(q).toMatchObject({currency:'USD',maxAmount:'0.30000000',maxBillableUnits:1});const args={quoteId:q.id,route:'test',idempotencyKey:randomUUID(),operation:'provider_search' as const,scope,jobKind:'provider_search' as const,dedupeKey:q.id,inputRef:scope,consent:true};const first=await user(ctx=>reserveJob(ctx,args));expect(await user(ctx=>reserveJob(ctx,args))).toEqual({...first,replayed:true});return first.jobId;}
const fake=vi.fn(async()=>Response.json([{id:pid,type:'normal',title:'合成搜索',timestamp:1780000000,url:`https://www.xiaohongshu.com/discovery/item/${pid}?xsec_token=fixture`,images:[]}]));
const deps={service,provider:new MockXhsProvider(),env,apifySearchFetch:fake};
beforeAll(async()=>{
 await pool.query(`insert into auth.users(id,email) values($1,$2)`,[uid,`${uid}@demo.invalid`]);
 await pool.query(`insert into organizations(id,name,settings) values($1,'Search test','{"provider_switches":{"live":true}}')`,[org]);
 await pool.query(`insert into memberships(org_id,user_id,role) values($1,$2,'org_admin')`,[org,uid]);
 await pool.query(`insert into notes(id,org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance) values($1,$2,'redfox',$3,'live',$4,'Existing','{}')`,[note,org,pid,`https://www.xiaohongshu.com/explore/${pid}`]);
 await pool.query(`insert into usage_budgets(org_id,subject_type,subject_id,period_start,period_end,currency,amount_limit) values($1,'org',$1,current_date-1,current_date+30,'USD',10)`,[org]);
 await pool.query(`insert into provider_price_versions(provider,endpoint,currency,unit,unit_cost,effective_at,verified_by,evidence) values('apify','AP02','USD','run',0.30,now()-interval '1 minute',$1,'Synthetic only')`,[uid]);
 await pool.query(`update provider_capabilities set price_status='verified' where provider='apify' and endpoint='AP02'`);
});
afterAll(async()=>{await pool.query(`update provider_capabilities set price_status='unknown' where provider='apify' and endpoint='AP02'`);await pool.end();});
it('reuses the RedFox card, saves original privately and settles the conservative cap',async()=>{
 const job=await enqueue();expect(await runJob(deps,job,'test')).toMatchObject({state:'succeeded',result:{notes:1,links:1}});
 expect((await pool.query(`select id from notes where org_id=$1 and platform_note_id=$2`,[org,pid])).rows).toEqual([{id:note}]);
 expect(await user(ctx=>originalNoteLink(ctx,service,note))).toContain(`/discovery/item/${pid}?xsec_token=fixture`);
 expect(JSON.stringify((await pool.query(`select provenance,canonical_url from notes where id=$1`,[note])).rows)).not.toContain('xsec_token');
 expect((await pool.query(`select status,actual_amount::text from usage_ledger where job_id=$1`,[job])).rows[0]).toEqual({status:'settled',actual_amount:'0.30000000'});
});
it('does not resubmit uncertain calls on lease recovery',async()=>{
 const job=await enqueue(),broken=vi.fn(async()=>{throw new Error('lost');});
 expect(await runJob({...deps,apifySearchFetch:broken},job,'a')).toMatchObject({state:'unknown_outcome'});
 await pool.query(`update app_jobs set state='running',lease_expires_at=now()-interval '1 minute' where id=$1`,[job]);
 expect(await runJob({...deps,apifySearchFetch:broken},job,'b')).toMatchObject({state:'unknown_outcome'});expect(broken).toHaveBeenCalledTimes(1);
});
it('honors withdrawn consent before submitting',async()=>{
 const job=await enqueue(),count=fake.mock.calls.length;
 await pool.query(`update consent_records set withdrawn_at=now() where org_id=$1 and policy_version='apify-search-v1'`,[org]);
 expect(await runJob(deps,job,'test')).toMatchObject({state:'failed',sent:false});expect(fake.mock.calls.length).toBe(count);
});
it('selects the approved USD search and shares the cache without a second reservation',async()=>{
 await user(ctx=>setAutoSearchPolicy(ctx,{enabled:true,provider:'apify',maxUsd:'0.30',expiresAt:new Date(Date.now()+86400000).toISOString()}));
 const a=await user(ctx=>requestAutoSearch(ctx,service,'新搜索',env));
 expect(await user(ctx=>requestAutoSearch(ctx,service,'新搜索',env))).toBe(a);
 const j=(await pool.query(`select j.id,j.input_ref from search_requests r join app_jobs j on j.id=r.job_id where r.id=$1`,[a])).rows[0];expect(j.input_ref.source).toBe('apify');
 await user(ctx=>setAutoSearchPolicy(ctx,{enabled:false}));
 const count=fake.mock.calls.length;expect(await runJob(deps,j.id,'test')).toMatchObject({state:'failed',sent:false});expect(fake.mock.calls.length).toBe(count);
});
