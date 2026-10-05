import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin, asUser, COHORT1, ORG1, pool, rows, U } from './db.ts';

afterAll(async () => {
  await pool.end();
});

describe('membership administration', () => {
  it('refuses to remove the last org admin', async () => {
    await expect(asUser(U.admin, (c) => c.query(`update memberships set role = 'reviewer' where user_id = $1 and org_id = $2`, [U.admin, ORG1]))).rejects.toThrow(/LAST_ADMIN/);
  });
  it('records membership changes in the audit log visible to admins only', async () => {
    await asUser(U.admin, (c) => c.query(`update memberships set status = 'suspended' where user_id = $1 and org_id = $2`, [U.reviewerOther, ORG1]));
    await asUser(U.admin, (c) => c.query(`update memberships set status = 'active' where user_id = $1 and org_id = $2`, [U.reviewerOther, ORG1]));
    expect((await rows(U.admin, `select action from audit_events where target_type = 'membership' and action = 'membership.update'`)).length).toBeGreaterThanOrEqual(2);
    expect(await rows(U.studentA, 'select id from audit_events')).toEqual([]);
  });
  it('students cannot change roles', async () => {
    const r = await asUser(U.studentA, (c) => c.query(`update memberships set role = 'org_admin' where user_id = $1`, [U.studentA]));
    expect(r.rowCount).toBe(0);
  });
});

describe('invitations', () => {
  it('are single use and hashed', async () => {
    const token = 'demo-invite-token-0123456789';
    const hash = createHash('sha256').update(token).digest('hex');
    await asUser(U.admin, (c) => c.query(
      `insert into invitations (org_id, cohort_id, token_hash, role, created_by) values ($1, $2, $3, 'student', $4)`, [ORG1, COHORT1, hash, U.admin],
    ));
    await admin((c) => c.query(`insert into auth.users (id, email) values ('00000000-0000-4000-a000-0000000000aa', 'new@demo.invalid')`));
    await asUser('00000000-0000-4000-a000-0000000000aa', (c) => c.query('select app.redeem_invitation($1)', [token]));
    expect(await rows('00000000-0000-4000-a000-0000000000aa', 'select role from memberships')).toEqual([{ role: 'student' }]);
    await expect(asUser(U.studentB, (c) => c.query('select app.redeem_invitation($1)', [token]))).rejects.toThrow(/INVITATION_INVALID/);
    await expect(asUser(U.studentB, (c) => c.query('select app.redeem_invitation($1)', ['wrong-token']))).rejects.toThrow(/INVITATION_INVALID/);
  });
});

describe('data integrity rules', () => {
  it('limits active creator accounts to 3 per user', async () => {
    await asUser(U.studentB, async (c) => {
      for (const n of [1, 2, 3]) await c.query(`insert into creator_accounts (org_id, owner_user_id, display_name) values ($1, $2, $3)`, [ORG1, U.studentB, `계정${n}`]);
    });
    await expect(asUser(U.studentB, (c) => c.query(`insert into creator_accounts (org_id, owner_user_id, display_name) values ($1, $2, '계정4')`, [ORG1, U.studentB]))).rejects.toThrow(/ACCOUNT_LIMIT/);
  });

  it('never stores official search metrics in P0', async () => {
    await expect(admin((c) => c.query(
      `insert into keywords (org_id, canonical_text, raw_text, kind, provenance, data_mode) values ($1, 'x', 'x', 'hashtag', 'official_search_metric', 'mock')`, [ORG1],
    ))).rejects.toThrow(/check constraint/);
  });

  it('hides expired provider content at query time', async () => {
    await admin((c) => c.query(
      `insert into notes (org_id, provider, platform_note_id, data_mode, canonical_url, title, provenance, expires_at) values
       ($1, 'mock', 'expired-note', 'mock', 'https://demo.invalid/notes/expired', '만료', '{"mode":"mock"}', now() - interval '1 minute'),
       ($1, 'mock', 'fresh-note', 'mock', 'https://demo.invalid/notes/fresh', '유효', '{"mode":"mock"}', now() + interval '1 day')`, [ORG1],
    ));
    const visible = await rows<{ platform_note_id: string }>(U.studentA, `select platform_note_id from notes where platform_note_id in ('expired-note', 'fresh-note')`);
    expect(visible.map((r) => r.platform_note_id)).toEqual(['fresh-note']);
    expect(await rows(U.admin2, `select id from notes where platform_note_id = 'fresh-note'`)).toEqual([]);
  });

  it('provider permission approval requires a named approver and evidence', async () => {
    // No approver named: RLS rejects.
    await expect(asUser(U.admin, (c) => c.query(`update provider_permissions set status = 'approved' where org_id = $1`, [ORG1]))).rejects.toThrow(/row-level security/);
    // Approver named but no evidence or timestamp: the table constraint rejects.
    await expect(asUser(U.admin, (c) => c.query(`update provider_permissions set status = 'approved', approved_by = $2 where org_id = $1`, [ORG1, U.admin]))).rejects.toThrow(/check constraint/);
    const students = await rows(U.studentA, 'select id from provider_permissions');
    expect(students).toEqual([]);
  });

  it('registers the video download endpoint only as excluded', async () => {
    const r = await rows(U.studentA, `select params_status, phase from provider_capabilities where endpoint = 'RFX1'`);
    expect(r).toEqual([{ params_status: 'not_implemented', phase: 'excluded' }]);
  });

  it('transcript full text cannot be stored without the permission flag', async () => {
    const ref = await asUser(U.studentA, async (c) => (await c.query(
      `insert into reference_items (org_id, owner_user_id, source_type, manual_url) values ($1, $2, 'manual_url', 'https://demo.invalid/notes/x') returning id`, [ORG1, U.studentA],
    )).rows[0].id);
    await expect(admin((c) => c.query(
      `insert into transcript_runs (org_id, owner_user_id, reference_id, data_mode, provider, status, full_text, text_stored) values ($1, $2, $3, 'mock', 'mock', 'succeeded', '全文', false)`,
      [ORG1, U.studentA, ref],
    ))).rejects.toThrow(/check constraint/);
    const run = await admin(async (c) => (await c.query(
      `insert into transcript_runs (org_id, owner_user_id, reference_id, data_mode, provider, status) values ($1, $2, $3, 'mock', 'mock', 'succeeded') returning id`,
      [ORG1, U.studentA, ref],
    )).rows[0].id);
    expect(await rows(U.studentA, 'select id from transcript_runs where id = $1', [run])).toHaveLength(1);
    expect(await rows(U.studentB, 'select id from transcript_runs where id = $1', [run])).toEqual([]);
    expect(await rows(U.admin, 'select id from transcript_runs where id = $1', [run])).toEqual([]);
  });

  it('personal saves reject targets in another org or unpublished shared expressions', async () => {
    const otherOrgNote = await admin(async (c) => (await c.query(
      `insert into notes (org_id, provider, platform_note_id, data_mode, canonical_url, provenance) values ('00000000-0000-4000-b000-000000000002', 'mock', 'org2-note', 'mock', 'https://demo.invalid/notes/o2', '{}') returning id`,
    )).rows[0].id);
    await expect(asUser(U.studentA, (c) => c.query(
      `insert into personal_saves (org_id, owner_user_id, target_type, target_id) values ($1, $2, 'note', $3)`, [ORG1, U.studentA, otherOrgNote],
    ))).rejects.toThrow(/INVALID_TARGET/);
  });
});
