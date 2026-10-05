import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountCandidates, compareReferenceAccounts, createReport, createTerm, deleteReferenceAccount, getReferenceAccount, ingestSearchResult, listLibrary,
  listReferenceAccounts, listReports, listTaxonomy, publishReference, requestSharing, resolveReport, runCheck, saveReferenceAccount, setTermActive,
  createReference, type Ctx, type Runner,
} from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { ORG1, ORG2, pool, U } from './db.ts';

const service: Runner = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); const o = await fn(c); await c.query('commit'); return o; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
async function as<T>(uid: string, fn: (ctx: Ctx) => Promise<T>, org = ORG1): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const role = (await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [org, uid])).rows[0]?.role ?? 'student';
    const out = await fn({ db: c, uid, orgId: org, role, mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
beforeAll(async () => {
  const has = (await pool.query(`select count(*)::int as n from notes where org_id = $1 and provider = 'mock' and not is_fallback`, [ORG1])).rows[0].n;
  if (!has) {
    const r = await new MockXhsProvider().searchNotes({ query: '' });
    await service((db) => ingestSearchResult(db, { orgId: ORG1, provider: 'mock', endpoint: r.endpoint, query: {} }, r));
  }
});
afterAll(async () => { await pool.end(); });

describe('F14 reference accounts (stored data only)', () => {
  it('lists author candidates, saves separately from own accounts, compares up to 3', async () => {
    const cands = await as(U.studentB, (ctx) => accountCandidates(ctx, { topic: 'beauty' }));
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.topics.includes('beauty'))).toBe(true);
    const ids: string[] = [];
    for (const c of cands.slice(0, 3)) ids.push(await as(U.studentB, (ctx) => saveReferenceAccount(ctx, c.authorRef)));
    expect(await as(U.studentB, (ctx) => saveReferenceAccount(ctx, cands[0]!.authorRef))).toBe(ids[0]); // idempotent
    const detail = await as(U.studentB, (ctx) => getReferenceAccount(ctx, ids[0]!));
    expect(detail.notes.length).toBeGreaterThan(0);
    expect(detail.account.snapshot.basis).toBe('stored_notes');
    expect(Object.keys(detail.topicCounts)).toContain('beauty');
    expect((await as(U.studentB, (ctx) => compareReferenceAccounts(ctx, ids))).length).toBe(ids.length);
    await expect(as(U.studentB, (ctx) => compareReferenceAccounts(ctx, [...ids, ids[0]!]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // private to the student; never counted as an own creator account
    expect(await as(U.studentA, (ctx) => listReferenceAccounts(ctx))).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: ids[0] })]));
    expect((await pool.query(`select count(*)::int as n from creator_accounts where display_name = $1`, [detail.account.displayName])).rows[0].n).toBe(0);
    await as(U.studentB, (ctx) => deleteReferenceAccount(ctx, ids[2] ?? ids[0]!));
  });
});

describe('reports', () => {
  it('false-positive reports resolve the rule key for staff; students cannot see the queue', async () => {
    const run = await as(U.studentA, (ctx) => runCheck(ctx, service, { sections: { title: '最好的面霜' }, facts: { sponsorship: 'no' } }));
    await as(U.studentA, (ctx) => createReport(ctx, { targetType: 'check_finding', targetId: run, findingIndex: 0, reason: 'false_positive', note: '문맥상 비교 표현' }));
    await expect(as(U.studentB, (ctx) => createReport(ctx, { targetType: 'check_finding', targetId: run, reason: 'false_positive' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const q = await as(U.reviewer, (ctx) => listReports(ctx));
    const mine = q.find((r) => r.targetId === run)!;
    expect(mine).toMatchObject({ reason: 'false_positive', ruleKey: 'abs-best@1' });
    await expect(as(U.studentA, (ctx) => listReports(ctx))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await as(U.reviewer, (ctx) => resolveReport(ctx, mine.id, 'resolved'));
    await expect(as(U.reviewer, (ctx) => resolveReport(ctx, mine.id, 'dismissed'))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a rights report hides a library item immediately', async () => {
    const S = (await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'rights@demo.invalid') returning id`)).rows[0].id;
    await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'student')`, [ORG1, S]);
    const ref = await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: 'x', title: '권리 테스트' }));
    await as(S, (ctx) => requestSharing(ctx, ref, { confirm: true }));
    const pub = await as(U.reviewer, (ctx) => publishReference(ctx, ref, 1));
    await as(U.studentB, (ctx) => createReport(ctx, { targetType: 'library_item', targetId: pub, reason: 'rights_issue', note: '원작자 요청' }));
    expect((await as(U.studentA, (ctx) => listLibrary(ctx))).some((l) => l.id === pub)).toBe(false);
  });
});

describe('taxonomy admin', () => {
  it('admins add org terms and deactivate (not delete); built-ins are fixed', async () => {
    const id = await as(U.admin, (ctx) => createTerm(ctx, { kind: 'region', slug: 'seoul-mapo', labelKo: '서울 마포', labelZh: '首尔麻浦' }));
    await expect(as(U.admin, (ctx) => createTerm(ctx, { kind: 'region', slug: 'seoul-mapo', labelKo: 'x' }))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(as(U.reviewer, (ctx) => createTerm(ctx, { kind: 'region', slug: 'busan', labelKo: '부산' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await as(U.admin, (ctx) => setTermActive(ctx, id, false));
    expect((await as(U.studentA, (ctx) => listTaxonomy(ctx))).some((t) => t.id === id)).toBe(false);
    expect((await as(U.admin, (ctx) => listTaxonomy(ctx, { includeInactive: true }))).find((t) => t.id === id)?.active).toBe(false);
    const builtin = (await pool.query(`select id from taxonomy_terms where org_id is null limit 1`)).rows[0].id;
    await expect(as(U.admin, (ctx) => setTermActive(ctx, builtin, false))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(U.admin, (ctx) => ctx.db.query(`delete from taxonomy_terms where id = $1`, [id]))).resolves.toMatchObject({ rowCount: 0 });
    expect((await as(U.admin2, (ctx) => listTaxonomy(ctx, { includeInactive: true }), ORG2)).some((t) => t.id === id)).toBe(false);
  });
});
