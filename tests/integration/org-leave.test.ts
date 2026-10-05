import { afterAll, describe, expect, it } from 'vitest';
import {
  createInvitation, createReference, DELETE_CONFIRM_TEXT, enqueueDeletion, requestDeletion, leaveOrganization, LEAVE_CONFIRM_TEXT, LocalPrivateStorage, runJob, setMemberStatus, type Ctx, type Runner,
} from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const storage = new LocalPrivateStorage(mkdtempSync(join(tmpdir(), 'xhs-leave-')));
const isMember = async (uid: string, org = ORG1) => as(uid, async (ctx) => (await ctx.db.query(`select app.is_member($1) as m`, [org])).rows[0].m as boolean, org);
async function freshStudent(email: string) {
  const id = (await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).rows[0].id as string;
  await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'student')`, [ORG1, id]);
  return id;
}
afterAll(async () => { await pool.end(); });

describe('voluntary org leave (F01)', () => {
  it('blocks access immediately, deletes data via the job, and allows rejoining by invitation', async () => {
    const S = await freshStudent('leaver@demo.invalid');
    await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: '떠날 메모', title: '떠날 자료' }));
    await expect(as(S, (ctx) => leaveOrganization(ctx, '나가기'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const reqId = await as(S, (ctx) => leaveOrganization(ctx, LEAVE_CONFIRM_TEXT));
    expect(await isMember(S)).toBe(false);
    expect((await pool.query(`select status from memberships where org_id = $1 and user_id = $2`, [ORG1, S])).rows[0].status).toBe('left');
    await expect(as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: 'x', title: '탈퇴 후' }))).rejects.toThrow();

    // The deletion job still runs although the owner is no longer an active member.
    await service((db) => enqueueDeletion(db, reqId));
    const job = (await pool.query(`select id from app_jobs where kind = 'user_deletion' and owner_user_id = $1`, [S])).rows[0].id;
    expect(await runJob({ service, provider: new MockXhsProvider(), storage }, job, 't')).toMatchObject({ state: 'succeeded' });
    expect((await pool.query(`select count(*)::int as n from reference_items where owner_user_id = $1`, [S])).rows[0].n).toBe(0);
    expect((await pool.query(`select scope, state from deletion_requests where id = $1`, [reqId])).rows[0]).toEqual({ scope: 'leave_org', state: 'partially_retained' });
    expect((await pool.query(`select count(*)::int as n from audit_events where org_id = $1 and actor_id = $2 and action = 'membership.left'`, [ORG1, S])).rows[0].n).toBe(1);

    // Admins cannot reactivate a member who left; a new invitation is required.
    await expect(as(U.admin, (ctx) => setMemberStatus(ctx, { userId: S, status: 'active', confirm: true }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const inv = await as(U.admin, (ctx) => createInvitation(ctx, { role: 'student' }));
    await as(S, async (ctx) => ctx.db.query(`select app.redeem_invitation($1)`, [inv.token]));
    expect(await isMember(S)).toBe(true);
  });

  it('the last active admin cannot leave and nothing changes', async () => {
    const before = (await pool.query(`select count(*)::int as n from deletion_requests where owner_user_id = $1`, [U.admin2])).rows[0].n;
    await expect(as(U.admin2, (ctx) => leaveOrganization(ctx, LEAVE_CONFIRM_TEXT), ORG2)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await isMember(U.admin2, ORG2)).toBe(true);
    expect((await pool.query(`select count(*)::int as n from deletion_requests where owner_user_id = $1`, [U.admin2])).rows[0].n).toBe(before);
  });

  it('a suspended member\'s pending deletion still completes', async () => {
    const S = await freshStudent('suspended-deleter@demo.invalid');
    await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: 'y', title: '중지 전 자료' }));
    const reqId = await as(S, (ctx) => requestDeletion(ctx, DELETE_CONFIRM_TEXT));
    await as(U.admin, (ctx) => setMemberStatus(ctx, { userId: S, status: 'suspended', confirm: true }));
    await service((db) => enqueueDeletion(db, reqId));
    const job = (await pool.query(`select id from app_jobs where kind = 'user_deletion' and owner_user_id = $1`, [S])).rows[0].id;
    expect(await runJob({ service, provider: new MockXhsProvider(), storage }, job, 't')).toMatchObject({ state: 'succeeded' });
    expect((await pool.query(`select count(*)::int as n from reference_items where owner_user_id = $1`, [S])).rows[0].n).toBe(0);
  });
});
