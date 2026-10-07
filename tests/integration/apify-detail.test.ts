import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createQuote, reserveJob, runJob, getNotes, purgeExpired, cancelJob, type Ctx, type Runner, type JobDeps } from '@xhs/core';
import { ApifyNoteDetailProvider, MockXhsProvider } from '@xhs/providers';
import { loadEnv } from '@xhs/domain';
import { pool, asUser as asOtherUser, U } from './db.ts';
import fixture from '../fixtures/apify/note-detail.sanitized.json' with { type: 'json' };

const org = randomUUID(), uid = randomUUID(), note = randomUUID();
const env = { ...loadEnv({}), APP_DATA_MODE: 'live' as const, LIVE_PROVIDER_CALLS_ENABLED: true, APIFY_ENABLED: true, APIFY_ACTOR_BUILD: '1.2.3', APIFY_TOKEN: 'test-only' };
const service: Runner = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); const out = await fn(c); await c.query('commit'); return out; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
const asUser = <T>(fn: (ctx: Ctx) => Promise<T>) => service(async db => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
  await db.query('set local role authenticated');
  return fn({ db, uid, orgId: org, role: 'org_admin', mode: 'live' });
});
const scope = { noteId: note };
const quote = () => asUser(ctx => createQuote(ctx, service, 'note_enrichment', scope, { env }));
async function enqueue() {
  const q = await quote();
  const args = { quoteId: q.id, route: 'POST /notes/enrich', idempotencyKey: randomUUID(), operation: 'note_enrichment' as const, scope, jobKind: 'note_enrichment' as const, dedupeKey: q.id, inputRef: scope, consent: true };
  const first = await asUser(ctx => reserveJob(ctx, args));
  expect(await asUser(ctx => reserveJob(ctx, args))).toEqual({ ...first, replayed: true });
  return first.jobId;
}
const fake = vi.fn(async () => new Response(JSON.stringify(fixture)));
const deps: JobDeps = { service, provider: new MockXhsProvider(), env, apifyDetailProvider: o => new ApifyNoteDetailProvider(o, fake) };
beforeAll(async () => {
  await pool.query(`insert into auth.users(id,email) values ($1,$2)`, [uid, `${uid}@demo.invalid`]);
  await pool.query(`insert into organizations(id,name,settings) values ($1,'Apify test',$2)`, [org, { provider_switches: { live: true }, daily_limits: { provider_search: 100 } }]);
  await pool.query(`insert into memberships(org_id,user_id,role) values ($1,$2,'org_admin')`, [org, uid]);
  await pool.query(`insert into notes(id,org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance) values ($1,$2,'redfox','aaaaaaaaaaaaaaaaaaaaaaaa','live','https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa','Original RedFox','{}')`,[note,org]);
  await pool.query(`insert into usage_budgets(org_id,subject_type,subject_id,period_start,period_end,currency,amount_limit) values ($1,'org',$1,current_date-1,current_date+30,'USD',10)`,[org]);
  await pool.query(`insert into provider_price_versions(provider,endpoint,currency,unit,unit_cost,effective_at,verified_by,evidence) values ('apify','AP01','USD','run',0.05,now()-interval '1 minute',$1,'synthetic apify test')`,[uid]);
  await pool.query(`update provider_capabilities set price_status='verified' where provider='apify' and endpoint='AP01'`);
});
afterAll(async () => { await pool.query(`update provider_capabilities set price_status='unknown' where provider='apify'`); await pool.end(); });

describe('Apify enrichment alongside RedFox (fake fetch only)', () => {
  it('rejects students and reviewers before quoting or reserving enrichment', async () => {
    for (const role of ['student', 'reviewer'] as const) {
      await expect(asUser(ctx => createQuote({...ctx,role},service,'note_enrichment',scope,{env}))).rejects.toMatchObject({code:'FORBIDDEN'});
      const q = await quote();
      await expect(asUser(ctx => reserveJob({...ctx,role},{quoteId:q.id,route:'test',idempotencyKey:randomUUID(),operation:'note_enrichment',scope,jobKind:'note_enrichment',dedupeKey:q.id,inputRef:scope,consent:true}))).rejects.toMatchObject({code:'FORBIDDEN'});
    }
  });
  it('quotes a pinned run in USD, requires explicit consent, and reserves only once', async () => {
    const q = await quote();
    expect(q).toMatchObject({ maxAmount: '0.05000000', currency: 'USD', maxBillableUnits: 1 });
    await expect(asUser(ctx => reserveJob(ctx,{ quoteId:q.id,route:'test',idempotencyKey:randomUUID(),operation:'note_enrichment',scope,jobKind:'note_enrichment',dedupeKey:q.id,inputRef:scope }))).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  });
  it('enriches the original card without modifying RedFox or storing tokens, without a permission record and hides on expiry', async () => {
    const job = await enqueue();
    expect(await runJob(deps,job,'test')).toMatchObject({state:'succeeded'});
    expect((await asUser(ctx => getNotes(ctx,[note])))[0]).toMatchObject({title:'美食 vlog',coverUrl:'https://sns-na-i4.xhscdn.com/synthetic-cover.jpg'});
    expect((await pool.query(`select title,provider from notes where id=$1`,[note])).rows[0]).toEqual({title:'Original RedFox',provider:'redfox'});
    expect(await asOtherUser(U.studentC, async db => (await db.query('select * from note_enrichments where note_id=$1',[note])).rows)).toEqual([]);
    await expect(asUser(ctx => ctx.db.query('delete from note_enrichments where note_id=$1',[note]))).rejects.toThrow(/permission denied/);
    const stored = (await pool.query(`select * from note_enrichments where note_id=$1`,[note])).rows[0];
    expect(JSON.stringify(stored)).not.toMatch(/xsec_token|video_video_url|points|ip_location/);
    expect(stored.permission_id).toBeNull();
    await pool.query(`update note_enrichments set expires_at=now()-interval '1 second' where note_id=$1`,[note]);
    expect((await asUser(ctx => getNotes(ctx,[note])))[0]?.title).toBe('Original RedFox');
  });
  it('purges expired enrichment content', async () => {
    expect((await service(purgeExpired)).noteEnrichments).toBeGreaterThanOrEqual(1);
    expect((await pool.query('select * from note_enrichments where note_id=$1',[note])).rowCount).toBe(0);
  });
  it('does not resend after a lost response or an expired worker lease', async () => {
    const job = await enqueue();
    const broken = vi.fn(async () => { throw new Error('network response lost'); });
    expect(await runJob({...deps,apifyDetailProvider:o=>new ApifyNoteDetailProvider(o,broken)},job,'test')).toMatchObject({state:'unknown_outcome'});
    await pool.query(`update app_jobs set state='running',lease_expires_at=now()-interval '1 minute' where id=$1`,[job]);
    expect(await runJob({...deps,apifyDetailProvider:o=>new ApifyNoteDetailProvider(o,broken)},job,'test2')).toMatchObject({state:'unknown_outcome'});
    expect(broken).toHaveBeenCalledTimes(1);
    expect((await pool.query(`select status from usage_ledger where job_id=$1`,[job])).rows[0].status).toBe('unknown_outcome');
  });
  it('releases a queued reservation when the stop switch is enabled before sending', async () => {
    const job = await enqueue(); const before = fake.mock.calls.length;
    await pool.query(`update organizations set settings=jsonb_set(settings,'{provider_switches,kill}','true') where id=$1`,[org]);
    expect(await runJob(deps,job,'test')).toMatchObject({state:'failed',sent:false});
    expect(fake.mock.calls.length).toBe(before);
    expect((await pool.query(`select status from usage_ledger where job_id=$1`,[job])).rows[0].status).toBe('released');
    await pool.query(`update organizations set settings=jsonb_set(settings,'{provider_switches,kill}','false') where id=$1`,[org]);
  });
  it('blocks sending after consent withdrawal or budget exhaustion', async () => {
    const job = await enqueue(); const before = fake.mock.calls.length;
    await pool.query("update consent_records set withdrawn_at=now() where org_id=$1 and policy_version='apify-zen-detail-v1'",[org]);
    expect(await runJob(deps,job,'test')).toMatchObject({state:'failed',sent:false});
    expect(fake.mock.calls.length).toBe(before);
    await pool.query("update usage_budgets set amount_limit=reserved_total+settled_total where org_id=$1",[org]);
    await expect(enqueue()).rejects.toMatchObject({code:'BUDGET_EXCEEDED'});
    await pool.query("update usage_budgets set amount_limit=10 where org_id=$1",[org]);
  });
  it('rejects an inaccessible note and mismatched job input', async () => {
    await expect(asUser(ctx => createQuote(ctx,service,'note_enrichment',{noteId:randomUUID()},{env}))).rejects.toMatchObject({code:'NOT_FOUND'});
    const q = await quote();
    await expect(asUser(ctx=>reserveJob(ctx,{quoteId:q.id,route:'test',idempotencyKey:randomUUID(),operation:'note_enrichment',scope,jobKind:'note_enrichment',dedupeKey:q.id,inputRef:{noteId:randomUUID()},consent:true}))).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  });
  it('prices multiple targets and preserves paid reservations on cancellation between notes', async () => {
    const second = randomUUID();
    await pool.query(`insert into notes(id,org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance) values ($1,$2,'redfox','bbbbbbbbbbbbbbbbbbbbbbbb','live','https://www.xiaohongshu.com/explore/bbbbbbbbbbbbbbbbbbbbbbbb','Second RedFox','{}')`,[second,org]);
    const batch = {noteIds:[note,second]};
    const q = await asUser(ctx=>createQuote(ctx,service,'note_enrichment',batch,{env}));
    expect(q).toMatchObject({maxAmount:'0.10000000',maxBillableUnits:2});
    const job = await asUser(ctx=>reserveJob(ctx,{quoteId:q.id,route:'batch',idempotencyKey:randomUUID(),operation:'note_enrichment',scope:batch,jobKind:'note_enrichment',dedupeKey:q.id,inputRef:batch,consent:true}));
    expect(await runJob(deps,job.jobId,'test')).toMatchObject({state:'waiting_external'});
    await asUser(ctx=>cancelJob(ctx,job.jobId));
    expect((await pool.query(`select status from usage_ledger where job_id=$1`,[job.jobId])).rows[0].status).toBe('unknown_outcome');
    expect((await pool.query(`select result_ref from app_jobs where id=$1`,[job.jobId])).rows[0].result_ref.completed).toBe(1);
  });

});
