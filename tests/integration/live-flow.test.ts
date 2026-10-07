import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQuote, createReference, getNotes, reserveJob, runJob, type Ctx, type JobDeps, type Runner } from '@xhs/core';
import { loadEnv } from '@xhs/domain';
import { MockXhsProvider, RedfoxXhsProvider } from '@xhs/providers';
import { randomUUID } from 'node:crypto';
import { pool } from './db.ts';

/**
 * Live path end to end against a FAKE RedFox (an injected fetch; nothing leaves the
 * machine). Uses its own org so prices/budgets/switches never touch other tests.
 */
const ORG = randomUUID();
const ADMIN = randomUUID();
const STUDENT = randomUUID();
const liveEnv = { ...loadEnv({}), APP_DATA_MODE: 'live' as const, LIVE_PROVIDER_CALLS_ENABLED: true, TRANSCRIPT_ENABLED: true, REDFOX_API_KEY: 'test-key-not-real' };

const service: Runner = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); const o = await fn(c); await c.query('commit'); return o; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
async function asStudent<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [STUDENT]);
    await c.query('set local role authenticated');
    const out = await fn({ db: c, uid: STUDENT, orgId: ORG, role: 'student', mode: 'live' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

type Call = { url: string; key: string | null; body: Record<string, unknown> };
function fakeRedfox(script: ((path: string, body: Record<string, unknown>) => unknown)[]) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, key: new Headers(init?.headers).get('REDFOX_API_KEY'), body });
    const step = script.shift();
    if (!step) throw new Error('unexpected extra provider call');
    const out = step(new URL(url).pathname, body);
    if (out instanceof Error) throw out;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, impl };
}
const deps = (impl?: typeof fetch): JobDeps => ({
  service, provider: new MockXhsProvider(), env: liveEnv, pollBaseMs: 1,
  ...(impl ? { liveProvider: (g) => new RedfoxXhsProvider(liveEnv.REDFOX_API_KEY, g.gateFor, impl, g.capabilities, undefined, g.searchEndpoint) } : {}),
});

async function videoReference(n: number): Promise<{ refId: string; noteId: string }> {
  const noteId = (await pool.query(
    `insert into notes (org_id, provider, platform_note_id, data_mode, canonical_url, note_type, title, provenance)
     values ($1, 'redfox', $2, 'live', $3, 'video', '라이브 테스트 영상', '{"source":"test"}') returning id`,
    [ORG, `live-${n}`, `https://www.xiaohongshu.com/explore/live${n}`],
  )).rows[0].id as string;
  const refId = await asStudent((ctx) => createReference(ctx, { sourceType: 'saved_note', noteId }));
  return { refId, noteId };
}
async function quoteAndReserve(refId: string, noteId: string, consent = true) {
  const scope = { referenceId: refId, noteId };
  const q = await asStudent((ctx) => createQuote(ctx, service, 'transcript_submit', scope, { env: liveEnv }));
  const { jobId } = await asStudent((ctx) => reserveJob(ctx, {
    quoteId: q.id, route: 'POST /references/:id/transcript-jobs', idempotencyKey: randomUUID(), operation: 'transcript_submit', scope,
    jobKind: 'transcript_submit', dedupeKey: `transcript_submit:${q.id}`, inputRef: scope, consent,
  }));
  return { quote: q, jobId };
}
const ledgerOf = async (jobId: string) => (await pool.query(`select l.status, l.reserved_amount::text as reserved, l.actual_amount::text as actual from usage_ledger l join app_jobs j on j.reserved_usage_id = l.id where j.id = $1`, [jobId])).rows[0];
const budget = async () => (await pool.query(`select reserved_total::text as reserved, settled_total::text as settled from usage_budgets where org_id = $1 and subject_type = 'org'`, [ORG])).rows[0];

beforeAll(async () => {
  await pool.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [ADMIN, `live-admin-${ORG}@demo.invalid`, STUDENT, `live-student-${ORG}@demo.invalid`]);
  await pool.query(`insert into organizations (id, name, settings) values ($1, '라이브 경로 테스트 조직', $2)`,
    [ORG, { provider_switches: { live: true, kill: false }, daily_limits: { transcript: 50, provider_search: 50, ai: 50 } }]);
  await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'org_admin'), ($1, $3, 'student')`, [ORG, ADMIN, STUDENT]);
  const asset = (await pool.query(`insert into assets (org_id, owner_user_id, storage_key, mime, size_bytes, origin, state, purpose)
    values ($1, $2, $3, 'application/pdf', 10, 'user_upload', 'ready', 'permission_evidence') returning id`, [ORG, ADMIN, `test/${ORG}.pdf`])).rows[0].id;
  await pool.query(`insert into provider_permissions (org_id, provider, scope, status, allowed_endpoints, allow_fetch, allow_excerpt_display, approved_by, approved_at, evidence_private_file_id)
    values ($1, 'redfox', 'cohort', 'approved', '{RF13,RF14}', true, true, $2, now(), $3)`, [ORG, ADMIN, asset]);
  await pool.query(`insert into usage_budgets (org_id, subject_type, subject_id, period_start, period_end, currency, amount_limit)
    values ($1, 'org', $1, current_date - 1, current_date + 30, 'CNY', 10)`, [ORG]);
  await pool.query(`insert into provider_price_versions (provider, endpoint, currency, unit, unit_cost, effective_at, verified_by, evidence)
    values ('redfox', 'RF13', 'CNY', 'call', 0.5, now() - interval '1 minute', $1, 'test evidence'), ('redfox', 'RF14', 'CNY', 'call', 0.01, now() - interval '1 minute', $1, 'test evidence')`, [ADMIN]);
  await pool.query(`update provider_capabilities set price_status = 'verified' where provider = 'redfox' and endpoint in ('RF13', 'RF14')`);
});
afterAll(async () => {
  await pool.query(`update provider_capabilities set price_status = 'unknown' where provider = 'redfox' and endpoint in ('RF01', 'RF02', 'RF13', 'RF14')`);
  await pool.query(`delete from provider_price_versions where evidence = 'test evidence'`);
  await pool.end();
});

describe('live transcript path with a fake RedFox (no network)', () => {
  it('quotes from verified prices, needs consent, calls with the server key, settles the reservation and polls the result', async () => {
    const { refId, noteId } = await videoReference(1);
    const scope = { referenceId: refId, noteId };
    const q = await asStudent((ctx) => createQuote(ctx, service, 'transcript_submit', scope, { env: liveEnv }));
    expect(q).toMatchObject({ mode: 'live', currency: 'CNY', maxAmount: '0.70000000', maxBillableUnits: 21 });
    await expect(asStudent((ctx) => reserveJob(ctx, {
      quoteId: q.id, route: 'POST /references/:id/transcript-jobs', idempotencyKey: randomUUID(), operation: 'transcript_submit', scope,
      jobKind: 'transcript_submit', dedupeKey: `transcript_submit:${q.id}`, inputRef: scope,
    }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const { jobId } = await asStudent((ctx) => reserveJob(ctx, {
      quoteId: q.id, route: 'POST /references/:id/transcript-jobs', idempotencyKey: randomUUID(), operation: 'transcript_submit', scope,
      jobKind: 'transcript_submit', dedupeKey: `transcript_submit:${q.id}`, inputRef: scope, consent: true,
    }));
    expect(await budget()).toEqual({ reserved: '0.70000000', settled: '0.00000000' });

    const fake = fakeRedfox([
      () => ({ code: 2000, data: { taskId: 'task-1' } }),
      () => ({ code: 2000, data: { taskId: 'task-1', status: 'processing' } }),
      () => ({ code: 2000, data: { taskId: 'task-1', status: 'succeeded', text: '大家好 今天分享', stampSents: [{ textSeg: '大家好', start: 0, end: 900 }, { textSeg: '今天分享', start: 900, end: 2000 }] } }),
    ]);
    expect(await runJob(deps(fake.impl), jobId, 't')).toMatchObject({ state: 'succeeded' });
    expect(fake.calls[0]).toMatchObject({ url: 'https://redfox.hk/story/api/parseWork/audioTextExtract/submit/xhs', key: 'test-key-not-real' });
    expect(new URL(fake.calls[0]!.url).hostname).toBe('redfox.hk');
    expect(fake.calls[0]!.body).toEqual({ url: 'https://www.xiaohongshu.com/explore/live1' });
    expect(await ledgerOf(jobId)).toEqual({ status: 'settled', reserved: '0.70000000', actual: '0.70000000' });
    expect(await budget()).toEqual({ reserved: '0.00000000', settled: '0.70000000' });
    expect((await pool.query(`select count(*)::int as n from consent_records where user_id = $1 and purpose = 'transcript' and withdrawn_at is null`, [STUDENT])).rows[0].n).toBe(1);

    const poll = (await pool.query(`select id from app_jobs where org_id = $1 and kind = 'transcript_result' order by created_at desc limit 1`, [ORG])).rows[0].id;
    expect(await runJob(deps(fake.impl), poll, 't')).toMatchObject({ state: 'waiting_external' });
    await pool.query(`update app_jobs set visible_after = now() where id = $1`, [poll]);
    expect(await runJob(deps(fake.impl), poll, 't')).toMatchObject({ state: 'succeeded' });
    expect(fake.calls.map((c) => c.body)).toEqual([{ url: 'https://www.xiaohongshu.com/explore/live1' }, { taskId: 'task-1' }, { taskId: 'task-1' }]);
    expect((await pool.query(`select status from transcript_runs where reference_id = $1`, [refId])).rows[0].status).toBe('succeeded');
  });

  it('a permission revoked after the quote blocks before any request and releases the reservation', async () => {
    const { refId, noteId } = await videoReference(2);
    const { jobId } = await quoteAndReserve(refId, noteId);
    await pool.query(`update provider_permissions set status = 'revoked' where org_id = $1`, [ORG]);
    const fake = fakeRedfox([]);
    try {
      expect(await runJob(deps(fake.impl), jobId, 't')).toMatchObject({ state: 'failed' });
    } finally {
      await pool.query(`update provider_permissions set status = 'approved' where org_id = $1`, [ORG]);
    }
    expect(fake.calls).toHaveLength(0);
    expect((await ledgerOf(jobId)).status).toBe('released');
    expect((await budget()).reserved).toBe('0.00000000');
  });

  it('a lost RF13 response is unknown_outcome: kept reserved for reconciliation and never resent', async () => {
    const { refId, noteId } = await videoReference(3);
    const { jobId } = await quoteAndReserve(refId, noteId);
    const fake = fakeRedfox([() => new TypeError('fetch failed')]);
    expect(await runJob(deps(fake.impl), jobId, 't')).toMatchObject({ state: 'unknown_outcome' });
    expect(fake.calls).toHaveLength(1);
    expect((await ledgerOf(jobId)).status).toBe('unknown_outcome');
    expect((await pool.query(`select status from transcript_runs where reference_id = $1`, [refId])).rows[0].status).toBe('unknown_outcome');
    // The same job is not claimable again (no automatic resend of a non-idempotent submit).
    expect(await runJob(deps(fake.impl), jobId, 't')).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  it('a worker without live wiring refuses live jobs and releases them', async () => {
    const { refId, noteId } = await videoReference(4);
    const { jobId } = await quoteAndReserve(refId, noteId);
    expect(await runJob(deps(), jobId, 't')).toMatchObject({ state: 'failed', errorCode: 'live_not_configured' });
    expect((await ledgerOf(jobId)).status).toBe('released');
  });

  it('refuses quotes without a price, beyond the budget, or for operations without a provider contract', async () => {
    const { refId, noteId } = await videoReference(5);
    // No price for RF01 (search) and no permission for it.
    await expect(asStudent((ctx) => createQuote(ctx, service, 'provider_search', { query: '护肤' }, { env: liveEnv })))
      .rejects.toMatchObject({ code: 'LIVE_BLOCKED', messageKo: expect.stringContaining('단가 미확인') });
    await expect(asStudent((ctx) => createQuote(ctx, service, 'reference_analysis', { referenceId: refId }, { env: liveEnv })))
      .rejects.toMatchObject({ code: 'LIVE_BLOCKED' });
    // Budget: 10 limit, 0.70 settled, 0.70 unknown-outcome reserved → shrink the limit so 0.70 no longer fits.
    await pool.query(`update usage_budgets set amount_limit = 1.5 where org_id = $1 and subject_type = 'org'`, [ORG]);
    await expect(quoteAndReserve(refId, noteId)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    await pool.query(`update usage_budgets set amount_limit = 10 where org_id = $1 and subject_type = 'org'`, [ORG]);
  });

  it('live search: ingests documented RF01 fields, drops excerpts without excerpt permission, releases on a non-2xx answer', async () => {
    await pool.query(`update provider_permissions set allowed_endpoints = '{RF01,RF13,RF14}', allow_metadata_display = true, allow_excerpt_display = false where org_id = $1`, [ORG]);
    await pool.query(`insert into provider_price_versions (provider, endpoint, currency, unit, unit_cost, effective_at, verified_by, evidence)
      values ('redfox', 'RF01', 'CNY', 'call', 0.06, now() - interval '1 minute', $1, 'test evidence')`, [ADMIN]);
    await pool.query(`update provider_capabilities set price_status = 'verified' where provider = 'redfox' and endpoint = 'RF01'`);
    const search = async (impl: typeof fetch) => {
      const scope = { query: '护肤' };
      const q = await asStudent((ctx) => createQuote(ctx, service, 'provider_search', scope, { env: liveEnv }));
      expect(q).toMatchObject({ mode: 'live', maxAmount: '0.06000000' });
      const { jobId } = await asStudent((ctx) => reserveJob(ctx, {
        quoteId: q.id, route: 'POST /discover/refresh', idempotencyKey: randomUUID(), operation: 'provider_search', scope,
        jobKind: 'provider_search', dedupeKey: `provider_search:${q.id}`, inputRef: scope, consent: true,
      }));
      return { jobId, outcome: await runJob(deps(impl), jobId, 't') };
    };
    const ok = fakeRedfox([() => ({ code: 2000, msg: '成功', data: { articles: [{ id: '6a00000000000000000000d4', title: '实测形状', desc: '正文 #护肤', authorId: 'a1b2c3d4e5f6a7b8', authorNickname: '作者', likedCount: 5, collectedCount: 2, createTime: '2026-10-01 08:00:00', shareInfoLink: 'https://www.xiaohongshu.com/explore/6a00000000000000000000d4' }], relatedSearches: [{ keyword: '敏感肌' }], total: 1 } })]);
    const first = await search(ok.impl);
    expect(first.outcome).toMatchObject({ state: 'succeeded' });
    expect(ok.calls[0]!.body).toEqual({ keyword: '护肤' });
    const note = (await pool.query(`select title, body_excerpt, note_type, data_mode, provider, provider_tags from notes where org_id = $1 and platform_note_id = '6a00000000000000000000d4'`, [ORG])).rows[0];
    expect(note).toEqual({ title: '实测形状', body_excerpt: null, note_type: null, data_mode: 'live', provider: 'redfox', provider_tags: ['护肤'] });
    expect(await ledgerOf(first.jobId)).toEqual({ status: 'settled', reserved: '0.06000000', actual: '0.06000000' });
    expect((await pool.query(`select count(*)::int as n from consent_records where user_id = $1 and purpose = 'external_provider_query'`, [STUDENT])).rows[0].n).toBe(1);

    const bad = fakeRedfox([() => new Response('{}', { status: 502 })]);
    const second = await search(bad.impl);
    expect(second.outcome).toMatchObject({ state: 'failed' });
    expect((await ledgerOf(second.jobId)).status).toBe('released'); // provider: failed (non-200) requests are not charged
    await pool.query(`update provider_permissions set allow_excerpt_display = true where org_id = $1`, [ORG]); // transcript needs excerpt display
  });

  it('live search switches to RF02 once priced and permitted; covers are kept only with media display and hidden when it is withdrawn', async () => {
    await pool.query(`insert into provider_price_versions (provider, endpoint, currency, unit, unit_cost, effective_at, verified_by, evidence)
      values ('redfox', 'RF02', 'CNY', 'call', 0.02, now() - interval '1 minute', $1, 'test evidence')`, [ADMIN]);
    await pool.query(`update provider_capabilities set price_status = 'verified' where provider = 'redfox' and endpoint = 'RF02'`);
    const scope = { query: '首尔旅行' };
    // Priced but not in the permission yet: search stays on RF01.
    expect((await asStudent((ctx) => createQuote(ctx, service, 'provider_search', scope, { env: liveEnv }))).maxAmount).toBe('0.06000000');
    await pool.query(`update provider_permissions set allowed_endpoints = '{RF01,RF02,RF13,RF14}', allow_media_display = true where org_id = $1`, [ORG]);
    const q = await asStudent((ctx) => createQuote(ctx, service, 'provider_search', scope, { env: liveEnv }));
    expect(q).toMatchObject({ mode: 'live', maxAmount: '0.02000000' });
    const { jobId } = await asStudent((ctx) => reserveJob(ctx, {
      quoteId: q.id, route: 'POST /discover/refresh', idempotencyKey: randomUUID(), operation: 'provider_search', scope,
      jobKind: 'provider_search', dedupeKey: `provider_search:${q.id}`, inputRef: scope, consent: true,
    }));
    const cover = 'https://sns-i10.rednotecdn.com/notes_pre_post/abc?imageView2/2/w/576/format/webp&sign=s&t=7f000000';
    const fake = fakeRedfox([() => ({ code: 2000, msg: '成功', data: { total: 2, hasMore: true, list: [
      { workId: '6a00000000000000000000e5', workTitle: '首尔三天', workDesc: '路线 #首尔旅行', coverUrl: cover, workUrl: 'https://www.xiaohongshu.com/explore/6a00000000000000000000e5',
        workPublishTime: '2026-10-01 08:00:00', accountNickname: '作者', accountUserid: 'b1b2c3d4e5f6a7b8', workLikedCount: 210, workCollectedCount: 175, workCommentsCount: 45,
        workReadedCount: 980, workSharedCount: 28, workType: 'normal' },
      { workId: '6a00000000000000000000e6', workTitle: '视频', coverUrl: 'https://evil.example.com/x.jpg', workType: 'video', workLikedCount: '1.2万' },
    ] } })]);
    expect(await runJob(deps(fake.impl), jobId, 't')).toMatchObject({ state: 'succeeded' });
    expect(fake.calls[0]!.url).toBe('https://redfox.hk/story/api/xhsUser/searchArticle');
    expect(fake.calls[0]!.body).toEqual({ keyword: '首尔旅行', offset: 0, sortType: '_4' });
    expect(await ledgerOf(jobId)).toEqual({ status: 'settled', reserved: '0.02000000', actual: '0.02000000' });
    const rows = (await pool.query(`select id, platform_note_id, note_type, cover_url from notes where org_id = $1 and platform_note_id like '6a00000000000000000000e%' order by platform_note_id`, [ORG])).rows;
    expect(rows.map((r) => [r.note_type, r.cover_url])).toEqual([['image', cover], ['video', null]]); // non-XHS image hosts are dropped
    const labels = (await pool.query(`select t.kind, t.slug, nt.classifier_version, nt.confidence from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id where nt.note_id = $1 order by t.kind`, [rows[0].id])).rows;
    expect(labels).toEqual([{ kind: 'topic', slug: 'travel-outing', classifier_version: 'keyword-v1', confidence: 'low' }]); // tag 首尔旅行 → 旅行
    const cards = async () => asStudent((ctx) => getNotes(ctx, rows.map((r) => r.id)));
    const first = (await cards()).find((c) => c.platformNoteId.endsWith('e5'))!;
    expect(first.coverUrl).toBe(cover);
    expect(first.metrics.views).toMatchObject({ exact: 980 });
    await pool.query(`update provider_permissions set allow_media_display = false where org_id = $1`, [ORG]);
    expect((await cards()).every((c) => c.coverUrl === null)).toBe(true); // withdrawn permission hides stored covers at once
  });

  it('stops polling RF14 after the reserved number of polls', async () => {
    const { refId, noteId } = await videoReference(6);
    const { jobId } = await quoteAndReserve(refId, noteId);
    const fake = fakeRedfox([() => ({ code: 2000, data: { taskId: 'task-6' } })]);
    await runJob(deps(fake.impl), jobId, 't');
    const poll = (await pool.query(`select id from app_jobs where org_id = $1 and kind = 'transcript_result' and provider_task_id = 'task-6'`, [ORG])).rows[0].id;
    await pool.query(`update app_jobs set attempts = 20, visible_after = now() where id = $1`, [poll]);
    expect(await runJob(deps(fake.impl), poll, 't')).toMatchObject({ state: 'failed', errorCode: 'transcript_poll_limit_needs_review' });
    expect(fake.calls).toHaveLength(1);
  });
});
