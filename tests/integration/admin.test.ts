import { afterAll, describe, expect, it } from 'vitest';
import {
  adminOverview, changeMemberRole, createCohort, createInvitation, getCohort, listAudit, listCohorts, listInvitations,
  listMembers, revokeInvitation, setCohortMember, setMemberStatus, type Ctx,
} from '@xhs/core';
import { COHORT1, ORG1, ORG2, pool, U } from './db.ts';

async function as<T>(uid: string, orgId: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const role = (await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [orgId, uid])).rows[0]?.role ?? 'student';
    const out = await fn({ db: c, uid, orgId, role, mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

afterAll(async () => {
  await pool.end();
});

describe('admin access', () => {
  it.each([['student', U.studentA], ['reviewer', U.reviewer]])('%s cannot use admin services', async (_l, uid) => {
    await expect(as(uid, ORG1, (ctx) => listMembers(ctx))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as(uid, ORG1, (ctx) => createInvitation(ctx, { role: 'student' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('member directory is empty even if a non-admin calls the SQL function directly', async () => {
    const r = await as(U.studentA, ORG1, async (ctx) => (await ctx.db.query(`select * from app.member_directory($1)`, [ORG1])).rows);
    expect(r).toEqual([]);
    const other = await as(U.admin2, ORG2, async (ctx) => (await ctx.db.query(`select * from app.member_directory($1)`, [ORG1])).rows);
    expect(other).toEqual([]);
  });

  it('lists only this org\'s members with emails and cohorts', async () => {
    const members = await as(U.admin, ORG1, (ctx) => listMembers(ctx));
    expect(members.map((m) => m.email)).toContain('student-a@demo.invalid');
    expect(members.some((m) => m.email.includes('other-org'))).toBe(false);
    expect(members.find((m) => m.userId === U.reviewer)?.cohorts).toEqual([{ id: COHORT1, name: '2026 가을 1기', role: 'reviewer' }]);
  });
});

describe('member changes', () => {
  it('require explicit confirmation', async () => {
    await expect(as(U.admin, ORG1, (ctx) => setMemberStatus(ctx, { userId: U.studentB, status: 'suspended', confirm: false }))).rejects.toThrow();
  });

  it('suspension removes access immediately and is audited', async () => {
    await as(U.admin, ORG1, (ctx) => setMemberStatus(ctx, { userId: U.reviewerOther, status: 'suspended', confirm: true }));
    const seen = await as(U.reviewerOther, ORG1, async (ctx) => (await ctx.db.query(`select id from organizations`)).rows);
    expect(seen).toEqual([]);
    await as(U.admin, ORG1, (ctx) => setMemberStatus(ctx, { userId: U.reviewerOther, status: 'active', confirm: true }));
    const audit = await as(U.admin, ORG1, (ctx) => listAudit(ctx));
    expect(audit.items.some((a) => a.action === 'membership.update' && a.actor === 'admin@demo.invalid')).toBe(true);
  });

  it('protects the last admin', async () => {
    await expect(as(U.admin, ORG1, (ctx) => changeMemberRole(ctx, { userId: U.admin, role: 'student', confirm: true }))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('demoting a reviewer deactivates their reviewer seats', async () => {
    const cohort = await as(U.admin, ORG1, (ctx) => createCohort(ctx, '역할 테스트 기수'));
    await as(U.admin, ORG1, (ctx) => setCohortMember(ctx, { cohortId: cohort, userId: U.reviewerOther, role: 'reviewer', active: true }));
    await as(U.admin, ORG1, (ctx) => changeMemberRole(ctx, { userId: U.reviewerOther, role: 'student', confirm: true }));
    const { members } = await as(U.admin, ORG1, (ctx) => getCohort(ctx, cohort));
    expect(members.find((m) => m.userId === U.reviewerOther)?.status).toBe('removed');
    await as(U.admin, ORG1, (ctx) => changeMemberRole(ctx, { userId: U.reviewerOther, role: 'reviewer', confirm: true }));
  });
});

describe('cohorts', () => {
  it('enforces role consistency and org membership', async () => {
    const cohort = await as(U.admin, ORG1, (ctx) => createCohort(ctx, '검증 기수'));
    await expect(as(U.admin, ORG1, (ctx) => setCohortMember(ctx, { cohortId: cohort, userId: U.studentA, role: 'reviewer', active: true }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(as(U.admin, ORG1, (ctx) => setCohortMember(ctx, { cohortId: cohort, userId: U.studentC, role: 'student', active: true }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await as(U.admin, ORG1, (ctx) => setCohortMember(ctx, { cohortId: cohort, userId: U.studentA, role: 'student', active: true }));
    const list = await as(U.admin, ORG1, (ctx) => listCohorts(ctx));
    expect(list.find((c) => c.id === cohort)).toMatchObject({ students: 1, reviewers: 0 });
  });

  it('archived cohorts accept no new members', async () => {
    const cohort = await as(U.admin, ORG1, (ctx) => createCohort(ctx, '보관 기수'));
    await as(U.admin, ORG1, (ctx) => updateCohortStatus(ctx, cohort));
    await expect(as(U.admin, ORG1, (ctx) => setCohortMember(ctx, { cohortId: cohort, userId: U.studentB, role: 'student', active: true }))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('another org admin cannot touch this org\'s cohort', async () => {
    await expect(as(U.admin2, ORG2, (ctx) => setCohortMember(ctx, { cohortId: COHORT1, userId: U.studentC, role: 'student', active: true }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

async function updateCohortStatus(ctx: Ctx, id: string) {
  const { updateCohort } = await import('@xhs/core');
  await updateCohort(ctx, id, { status: 'archived' });
}

describe('invitations', () => {
  it('returns the token once, stores only a hash, and redeems into the cohort', async () => {
    const { id, token } = await as(U.admin, ORG1, (ctx) => createInvitation(ctx, { role: 'student', cohortId: COHORT1, expiresInDays: 3 }));
    expect(token.length).toBeGreaterThanOrEqual(32);
    const stored = (await pool.query(`select token_hash from invitations where id = $1`, [id])).rows[0].token_hash;
    expect(stored).not.toContain(token);
    // A brand-new user joins through the link (other tests rely on fixed demo memberships).
    const newUser = '00000000-0000-4000-a000-0000000000bb';
    await pool.query(`insert into auth.users (id, email) values ($1, 'invited@demo.invalid') on conflict do nothing`, [newUser]);
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [newUser]);
      await c.query('set local role authenticated');
      await c.query(`select app.redeem_invitation($1)`, [token]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const members = await as(U.admin, ORG1, (ctx) => listMembers(ctx));
    expect(members.find((m) => m.userId === newUser)).toMatchObject({ role: 'student', cohorts: [{ id: COHORT1, name: '2026 가을 1기', role: 'student' }] });
    const inv = (await as(U.admin, ORG1, (ctx) => listInvitations(ctx))).find((i) => i.id === id);
    expect(inv?.state).toBe('used');
    await expect(as(U.admin, ORG1, (ctx) => revokeInvitation(ctx, id))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('revoked invitations cannot be redeemed', async () => {
    const { id, token } = await as(U.admin, ORG1, (ctx) => createInvitation(ctx, { role: 'reviewer' }));
    await as(U.admin, ORG1, (ctx) => revokeInvitation(ctx, id));
    await expect(as(U.admin2, ORG2, (ctx) => ctx.db.query(`select app.redeem_invitation($1)`, [token]))).rejects.toThrow(/INVITATION_INVALID/);
    expect((await as(U.admin, ORG1, (ctx) => listInvitations(ctx))).find((i) => i.id === id)?.state).toBe('revoked');
  });

  it('rejects admin invites bound to a cohort and expiry beyond 7 days', async () => {
    await expect(as(U.admin, ORG1, (ctx) => createInvitation(ctx, { role: 'org_admin', cohortId: COHORT1 }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(as(U.admin, ORG1, (ctx) => createInvitation(ctx, { role: 'student', expiresInDays: 30 }))).rejects.toThrow();
  });

  it('audit metadata never contains the token', async () => {
    const { token } = await as(U.admin, ORG1, (ctx) => createInvitation(ctx, { role: 'student' }));
    const dump = JSON.stringify((await pool.query(`select redacted_metadata from audit_events`)).rows);
    expect(dump).not.toContain(token);
    const overview = await as(U.admin, ORG1, (ctx) => adminOverview(ctx));
    expect(overview.open_invitations).toBeGreaterThan(0);
  });
});

describe('admins still cannot read student drafts', () => {
  it('no admin path exposes plans, references or transcripts', async () => {
    await pool.query(
      `insert into reference_items (org_id, owner_user_id, source_type, user_text) values ($1, $2, 'pasted_text', '학생 비공개 메모')`, [ORG1, U.studentA],
    );
    const rows = await as(U.admin, ORG1, async (ctx) => ({
      refs: (await ctx.db.query(`select id from reference_items`)).rows,
      plans: (await ctx.db.query(`select id from plans`)).rows,
      transcripts: (await ctx.db.query(`select id from transcript_runs`)).rows,
    }));
    expect(rows).toEqual({ refs: [], plans: [], transcripts: [] });
  });
});
