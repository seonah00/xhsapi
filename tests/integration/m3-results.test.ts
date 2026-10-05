import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addSnapshot, createAccount, createPublication, createQuote, listPublications, listReflections, reserveJob, runJob, type Ctx, type Runner } from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { ORG1, pool, U } from './db.ts';

const service: Runner = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); const o = await fn(c); await c.query('commit'); return o; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
async function as<T>(uid: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const out = await fn({ db: c, uid, orgId: ORG1, role: 'student', mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
let accountId: string;
beforeAll(async () => {
  // The cohort reviewer owns no other accounts in any test file.
  accountId = await as(U.reviewer, (ctx) => createAccount(ctx, { displayName: '성과 계정', topics: ['beauty'], mainTopic: 'beauty', audience: 'x', goals: ['grow_followers'], tone: 'plain', formats: ['vlog'], chineseLevel: 'beginner', showFace: true, useVoice: true }));
});
afterAll(async () => { await pool.end(); });

describe('results (F11)', () => {
  it('records publications with clean URLs and append-only nullable snapshots', async () => {
    const id = await as(U.reviewer, (ctx) => createPublication(ctx, { accountId, noteUrl: 'https://www.xiaohongshu.com/explore/6a3c7aa6000000001003e071?xsec_token=SECRET', publishedAt: '2026-10-01T00:00:00Z', title: '첫 게시물', format: 'vlog' }));
    await expect(as(U.reviewer, (ctx) => addSnapshot(ctx, id, { observedAt: '2026-09-01T00:00:00Z', metrics: { likes: 1 } }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(as(U.reviewer, (ctx) => addSnapshot(ctx, id, { observedAt: '2026-10-02T00:00:00Z', metrics: {} }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await as(U.reviewer, (ctx) => addSnapshot(ctx, id, { observedAt: '2026-10-02T00:00:00Z', metrics: { likes: 10, saves: 4 } }));
    await as(U.reviewer, (ctx) => addSnapshot(ctx, id, { observedAt: '2026-10-04T00:00:00Z', metrics: { likes: 20, saves: 9, views: 300 } }));
    const [p] = await as(U.reviewer, (ctx) => listPublications(ctx, accountId));
    expect(p!.noteUrl).toBe('https://www.xiaohongshu.com/explore/6a3c7aa6000000001003e071');
    expect(p!.snapshots).toHaveLength(2);
    expect(p!.snapshots[1]!.metrics).toMatchObject({ likes: 10, saves: 4, views: null, shares: null });
    await expect(as(U.studentB, (ctx) => addSnapshot(ctx, id, { observedAt: '2026-10-05T00:00:00Z', metrics: { likes: 1 } }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await as(U.admin, (ctx) => listPublications(ctx))).toEqual([]);
  });

  it('reflection uses only selected own snapshots and does not change the account profile', async () => {
    const pub2 = await as(U.reviewer, (ctx) => createPublication(ctx, { accountId, publishedAt: '2026-10-01T00:00:00Z', title: '리뷰', format: 'review' }));
    await as(U.reviewer, (ctx) => addSnapshot(ctx, pub2, { observedAt: '2026-10-04T00:00:00Z', metrics: { saves: 1 } }));
    const ids = (await as(U.reviewer, (ctx) => listPublications(ctx, accountId))).map((p) => p.snapshots[0]!.id);
    const before = (await pool.query(`select current_profile_version_id from creator_accounts where id = $1`, [accountId])).rows[0];
    await as(U.reviewer, async (ctx) => {
      const scope = { accountId, snapshotIds: ids.join(',') };
      const q = await createQuote(ctx, service, 'results_reflection', scope);
      return reserveJob(ctx, { quoteId: q.id, route: 'POST /results/reflections', idempotencyKey: 'idem-reflect-0001', operation: 'results_reflection', scope, jobKind: 'results_reflection', dedupeKey: `reflect:${q.id}`, inputRef: { accountId, snapshotIds: ids } });
    });
    for (const r of (await pool.query(`select id from app_jobs where kind = 'results_reflection' and state = 'queued'`)).rows) await runJob({ service, provider: new MockXhsProvider() }, r.id, 't');
    const refl = await as(U.reviewer, (ctx) => listReflections(ctx, accountId));
    expect(refl[0]!.output.hypotheses.join(' ')).toContain('형식');
    expect((await pool.query(`select current_profile_version_id from creator_accounts where id = $1`, [accountId])).rows[0]).toEqual(before);
  });

  it('rejects reflections over someone else\'s snapshots', async () => {
    const mine = (await as(U.reviewer, (ctx) => listPublications(ctx, accountId)))[0]!.snapshots[0]!.id;
    const other = await as(U.studentB, async (ctx) => (await ctx.db.query(`select id from creator_accounts where owner_user_id = $1 limit 1`, [U.studentB])).rows[0]?.id as string | undefined);
    if (!other) return;
    await as(U.studentB, async (ctx) => {
      const scope = { accountId: other, snapshotIds: mine };
      const q = await createQuote(ctx, service, 'results_reflection', scope);
      return reserveJob(ctx, { quoteId: q.id, route: 'POST /results/reflections', idempotencyKey: 'idem-reflect-0002', operation: 'results_reflection', scope, jobKind: 'results_reflection', dedupeKey: `reflect:${q.id}`, inputRef: { accountId: other, snapshotIds: [mine] } });
    });
    const job = (await pool.query(`select id from app_jobs where kind = 'results_reflection' and state = 'queued' and owner_user_id = $1`, [U.studentB])).rows[0];
    const outcome = await runJob({ service, provider: new MockXhsProvider() }, job.id, 't');
    expect(outcome).toMatchObject({ state: 'failed', errorCode: 'snapshots_unavailable' });
  });
});
