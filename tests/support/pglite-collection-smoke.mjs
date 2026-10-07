/** Optional in-process PostgreSQL smoke test; no sockets or provider requests.
 * PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --import tsx tests/support/pglite-collection-smoke.mjs
 * This checks SQL/RLS, not native PostgreSQL concurrency or browser E2E.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createQuote, reserveJob, runJob, discover, getNotes, cancelJob } from '@xhs/core';
import { loadEnv } from '@xhs/domain';
import { ApifyNoteDetailProvider, MockXhsProvider, RedfoxXhsProvider } from '@xhs/providers';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const pg = new PGlite();
const q = async (sql, params = []) => {
  const r = await pg.query(sql, params);
  return { rows:r.rows, rowCount:r.rows.length || r.affectedRows || 0 };
};
const db = { query:q };
const service = async fn => {
  await pg.exec('begin');
  try { const r = await fn(db); await pg.exec('commit'); return r; }
  catch(e) { await pg.exec('rollback'); throw e; }
};
const org=randomUUID(),uid=randomUUID();
const userDb = user => ({ query:async(sql,params=[])=> {
  await pg.exec('begin');
  try {
    await q(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);
    await pg.exec('set local role authenticated');
    const r=await q(sql,params);await pg.exec('commit');return r;
  } catch(e) { await pg.exec('rollback');throw e; }
} });
const ctx={db:userDb(uid),uid,orgId:org,role:'student',mode:'live'};
const env={...loadEnv({}),APP_DATA_MODE:'live',LIVE_PROVIDER_CALLS_ENABLED:true,APIFY_ENABLED:true,APIFY_ACTOR_BUILD:'1.2.3',APIFY_TOKEN:'synthetic-only'};
const checks=[];
try {
  await pg.exec(readFileSync('supabase/test/00_supabase_shim.sql','utf8'));
  for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await pg.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
  await pg.exec(readFileSync('supabase/seed.sql','utf8'));
  checks.push('all migrations + seed');
  await q(`insert into auth.users(id,email) values($1,$2)`,[uid,`${uid}@example.invalid`]);
  await q(`insert into organizations(id,name,settings) values($1,'WASM test',$2)`,[org,{provider_switches:{live:true},daily_limits:{provider_search:100}}]);
  await q(`insert into memberships(org_id,user_id,role) values($1,$2,'student')`,[org,uid]);
  const asset=(await q(`insert into assets(org_id,owner_user_id,storage_key,mime,size_bytes,origin,state,purpose) values($1,$2,$3,'application/pdf',10,'user_upload','ready','permission_evidence') returning id`,[org,uid,`test/${org}`])).rows[0].id;
  for(const [provider,endpoint,currency,price,unit] of [['redfox','RF02','CNY','0.06','call'],['apify','AP01','USD','0.05','run']]) {
    await q(`insert into provider_permissions(org_id,provider,scope,status,allowed_endpoints,allow_fetch,allow_metadata_display,allow_excerpt_display,allow_media_display,allow_cache,cache_ttl_seconds,approved_by,approved_at,evidence_private_file_id) values($1,$2,'environment','approved',$3,true,true,true,true,true,3600,$4,now(),$5)`,[org,provider,[endpoint],uid,asset]);
    await q(`insert into provider_price_versions(provider,endpoint,currency,unit,unit_cost,effective_at,verified_by,evidence) values($1,$2,$3,$4,$5,now()-interval '1 minute',$6,'synthetic fixture')`,[provider,endpoint,currency,unit,price,uid]);
    await q(`update provider_capabilities set price_status='verified' where provider=$1 and endpoint=$2`,[provider,endpoint]);
    await q(`insert into usage_budgets(org_id,subject_type,subject_id,period_start,period_end,currency,amount_limit) values($1,'org',$1,current_date-1,current_date+30,$2,10)`,[org,currency]);
  }
  async function enqueue(operation,scope) {
    const quote=await createQuote(ctx,service,operation,scope,{env});
    const args={quoteId:quote.id,route:'smoke',idempotencyKey:randomUUID(),operation,scope,jobKind:operation,dedupeKey:quote.id,inputRef:scope,consent:true};
    const job=await reserveJob(ctx,args);
    assert.deepEqual(await reserveJob(ctx,args),{...job,replayed:true});
    return {...job,quote};
  }
  const offsets=[];
  const fakeRedfox=async(_url,init)=> {
    const {offset}=JSON.parse(init.body);offsets.push(offset);
    return new Response(JSON.stringify({code:2000,data:{hasMore:true,total:100,list:Array.from({length:20},(_,i)=>({workId:(offset+i+1).toString(16).padStart(24,'0'),workTitle:`合成 ${offset+i}`,workType:'normal',workLikedCount:3}))}}));
  };
  const deps={service,env,provider:new MockXhsProvider(),liveProvider:g=>new RedfoxXhsProvider('synthetic-only',g.gateFor,fakeRedfox,g.capabilities,undefined,g.searchEndpoint)};
  const unauthorizedScope={query:'合成',targetCount:50};
  const tamperQuote=await createQuote(ctx,service,'provider_search',unauthorizedScope,{env});
  await assert.rejects(reserveJob(ctx,{quoteId:tamperQuote.id,route:'tamper',idempotencyKey:randomUUID(),operation:'provider_search',scope:unauthorizedScope,jobKind:'provider_search',dedupeKey:tamperQuote.id,inputRef:{...unauthorizedScope,targetCount:100},consent:true}),e=>e.code==='VALIDATION_FAILED');
  checks.push('quote/input scope tampering blocked');
  const search=await enqueue('provider_search',{query:'合成',targetCount:50});
  assert.equal(search.quote.maxAmount,'0.30000000');
  for(let i=0;i<3;i++) {
    await q(`update app_jobs set visible_after=null where id=$1`,[search.jobId]);
    const out=await runJob(deps,search.jobId,'test');
    assert.equal(out.state,i===2?'succeeded':'waiting_external');
  }
  assert.deepEqual(offsets,[0,20,40]);
  const ledger=(await q(`select status,actual_amount::text from usage_ledger where job_id=$1`,[search.jobId])).rows[0];
  assert.deepEqual(ledger,{status:'settled',actual_amount:'0.18000000'});
  const results=await discover(ctx,{q:'合成'});
  assert.equal(results.notes.length,50);
  assert.equal((await discover(ctx,{q:'合成',cursor:results.nextCursor})).notes.length,10);
  checks.push('50-target: 60 unique notes / offsets 0,20,40 / 50+10 display / 3-unit settlement');
  const noteIds=results.notes.slice(0,2).map(n=>n.id);
  const bulk=await enqueue('note_enrichment',{noteIds});
  assert.equal(bulk.quote.maxAmount,'0.10000000');
  const sent=[];
  const fakeApify=async(url,init)=> {
    assert.equal(new URL(url).searchParams.get('maxTotalChargeUsd'),'0.05000000');
    const {noteUrls}=JSON.parse(init.body);const note_id=noteUrls[0];sent.push(note_id);
    return new Response(JSON.stringify([{id:note_id,type:'video',title:'보완',images:[{url_pre:'https://sns-na-i4.xhscdn.com/synthetic.jpg'}],engagement:{liked_count:123}}]));
  };
  const apifyDeps={...deps,apifyDetailProvider:o=>new ApifyNoteDetailProvider(o,fakeApify)};
  assert.equal((await runJob(apifyDeps,bulk.jobId,'test')).state,'waiting_external');
  await q(`update app_jobs set visible_after=null where id=$1`,[bulk.jobId]);
  assert.equal((await runJob(apifyDeps,bulk.jobId,'restarted')).state,'succeeded');
  assert.equal(new Set(sent).size,2);
  assert.ok((await getNotes(ctx,noteIds)).every(n=>n.coverUrl?.includes('synthetic.jpg')));
  const stranger=randomUUID();
  assert.equal((await userDb(stranger).query(`select * from note_enrichments where org_id=$1`,[org])).rows.length,0);
  await assert.rejects(ctx.db.query(`delete from note_enrichments where org_id=$1`,[org]),/permission denied/);
  await q(`update provider_permissions set status='revoked' where org_id=$1 and provider='apify'`,[org]);
  assert.ok((await getNotes(ctx,noteIds)).every(n=>n.coverUrl===null));
  await q(`update provider_permissions set status='approved' where org_id=$1 and provider='apify'`,[org]);
  checks.push('Apify batch / per-run cap / resumed IDs / RLS isolation / revocation');
  const cancelBefore=await enqueue('note_enrichment',{noteIds});
  await cancelJob(ctx,cancelBefore.jobId);
  assert.equal((await q(`select status from usage_ledger where job_id=$1`,[cancelBefore.jobId])).rows[0].status,'released');
  const cancelAfter=await enqueue('note_enrichment',{noteIds});
  await runJob(apifyDeps,cancelAfter.jobId,'test');
  await cancelJob(ctx,cancelAfter.jobId);
  assert.equal((await q(`select status from usage_ledger where job_id=$1`,[cancelAfter.jobId])).rows[0].status,'unknown_outcome');
  checks.push('cancel before send releases / cancel after paid step keeps unknown reservation');
  const withdrawn=await enqueue('note_enrichment',{noteIds});
  await q(`update consent_records set withdrawn_at=now() where org_id=$1 and policy_version='apify-zen-detail-v1'`,[org]);
  const callsBefore=sent.length;
  assert.equal((await runJob(apifyDeps,withdrawn.jobId,'test')).state,'failed');
  assert.equal(sent.length,callsBefore);
  assert.equal((await q(`select status from usage_ledger where job_id=$1`,[withdrawn.jobId])).rows[0].status,'released');
  await q(`update usage_budgets set amount_limit=reserved_total+settled_total where org_id=$1 and currency='USD'`,[org]);
  await assert.rejects(enqueue('note_enrichment',{noteIds}),e=>e.code==='BUDGET_EXCEEDED');
  checks.push('withdrawn consent prevents sending / exhausted USD budget blocks reservation');
  console.log(JSON.stringify({engine:'PGlite (single-process SQL/RLS smoke only)',checks},null,2));
} finally {await pg.close();}
