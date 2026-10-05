import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, COHORT1, hex64, ORG1, ORG2, pool, rows, U } from './db.ts';

let accountId: string;
let planId: string;
let v1: string; // submitted version
let v2: string; // later, unsubmitted version
let runV1: string;
let submissionId: string;
let referenceId: string;

beforeAll(async () => {
  await asUser(U.studentA, async (c) => {
    accountId = (await c.query(
      `insert into creator_accounts (org_id, owner_user_id, display_name) values ($1, $2, '학생A 뷰티 계정') returning id`, [ORG1, U.studentA],
    )).rows[0].id;
    planId = (await c.query(
      `insert into plans (org_id, owner_user_id, account_id, title) values ($1, $2, $3, '비공개 초안') returning id`, [ORG1, U.studentA, accountId],
    )).rows[0].id;
    v1 = (await c.query(
      `insert into plan_versions (org_id, plan_id, version, content_json, content_hash, check_input_hash, created_by)
       values ($1, $2, 1, '{"title":"敏感肌护肤"}', $3, $4, $5) returning id`, [ORG1, planId, hex64('a'), hex64('b'), U.studentA],
    )).rows[0].id;
    v2 = (await c.query(
      `insert into plan_versions (org_id, plan_id, version, content_json, content_hash, check_input_hash, created_by)
       values ($1, $2, 2, '{"title":"更私密的草稿"}', $3, $4, $5) returning id`, [ORG1, planId, hex64('c'), hex64('d'), U.studentA],
    )).rows[0].id;
    referenceId = (await c.query(
      `insert into reference_items (org_id, owner_user_id, source_type, user_text) values ($1, $2, 'pasted_text', '비공개 메모') returning id`, [ORG1, U.studentA],
    )).rows[0].id;
  });
  // Rule check runs are written by the server.
  runV1 = await admin(async (c) => (await c.query(
    `insert into check_runs (org_id, owner_user_id, plan_version_id, content_hash, rules_version, status, completeness_json)
     values ($1, $2, $3, $4, 'test-1', 'completed', '{"rules":"completed","contextual":"completed"}') returning id`, [ORG1, U.studentA, v1, hex64('b')],
  )).rows[0].id);
  submissionId = await asUser(U.studentA, async (c) => (await c.query(
    `insert into submissions (org_id, owner_user_id, cohort_id, plan_version_id, check_run_id) values ($1, $2, $3, $4, $5) returning id`,
    [ORG1, U.studentA, COHORT1, v1, runV1],
  )).rows[0].id);
});

afterAll(async () => {
  await pool.end();
});

describe('private drafts are owner-only', () => {
  it.each([
    ['another student', U.studentB],
    ['unassigned reviewer', U.reviewerOther],
    ['org admin', U.admin],
    ['other-org student', U.studentC],
    ['other-org admin', U.admin2],
  ])('%s cannot see the plan, its versions or references', async (_label, uid) => {
    expect(await rows(uid, 'select id from plans where id = $1', [planId])).toEqual([]);
    expect(await rows(uid, 'select id from plan_versions where plan_id = $1', [planId])).toEqual([]);
    expect(await rows(uid, 'select id from reference_items where id = $1', [referenceId])).toEqual([]);
    expect(await rows(uid, 'select id from creator_accounts where id = $1', [accountId])).toEqual([]);
  });

  it('IDOR: another student cannot update or delete by id', async () => {
    const upd = await asUser(U.studentB, (c) => c.query(`update plans set title = 'hacked' where id = $1`, [planId]));
    const del = await asUser(U.studentB, (c) => c.query(`delete from reference_items where id = $1`, [referenceId]));
    expect(upd.rowCount).toBe(0);
    expect(del.rowCount).toBe(0);
    expect((await rows(U.studentA, 'select title from plans where id = $1', [planId]))[0]).toEqual({ title: '비공개 초안' });
  });
});

describe('cohort reviewer sees only the submitted immutable version', () => {
  it('reads the submitted version and its check run, not other versions or the plan', async () => {
    const versions = await rows<{ id: string }>(U.reviewer, 'select id from plan_versions where plan_id = $1', [planId]);
    expect(versions.map((v) => v.id)).toEqual([v1]);
    expect(await rows(U.reviewer, 'select id from check_runs where id = $1', [runV1])).toHaveLength(1);
    expect(await rows(U.reviewer, 'select id from submissions where id = $1', [submissionId])).toHaveLength(1);
    expect(await rows(U.reviewer, 'select id from plan_versions where id = $1', [v2])).toEqual([]);
    expect(await rows(U.reviewer, 'select id from reference_items where id = $1', [referenceId])).toEqual([]);
  });

  it('cannot rewrite the student version', async () => {
    await expect(asUser(U.reviewer, (c) => c.query(`update plan_versions set content_json = '{}' where id = $1`, [v1]))).rejects.toThrow(/permission denied/);
    await expect(admin((c) => c.query(`update plan_versions set content_json = '{}' where id = $1`, [v1]))).rejects.toThrow(/IMMUTABLE/);
  });

  it('student cannot change submission status directly', async () => {
    await expect(asUser(U.studentA, (c) => c.query(`update submissions set status = 'feedback_complete' where id = $1`, [submissionId]))).rejects.toThrow(/permission denied/);
  });

  it('only the assigned reviewer can leave feedback', async () => {
    await expect(asUser(U.reviewerOther, (c) => c.query(`select app.add_feedback($1, 'x', 'comment')`, [submissionId]))).rejects.toThrow(/NOT_FOUND/);
    await asUser(U.reviewer, (c) => c.query(`select app.add_feedback($1, '도입부가 좋아요', 'changes_requested')`, [submissionId]));
    expect((await rows(U.studentA, 'select status from submissions where id = $1', [submissionId]))[0]).toEqual({ status: 'changes_requested' });
    expect(await rows(U.studentA, 'select content from feedback where submission_id = $1', [submissionId])).toEqual([{ content: '도입부가 좋아요' }]);
    expect(await rows(U.studentB, 'select id from feedback where submission_id = $1', [submissionId])).toEqual([]);
  });
});

describe('submission validation', () => {
  it('rejects a check run whose hash does not match the version (stale check)', async () => {
    const staleRun = await admin(async (c) => (await c.query(
      `insert into check_runs (org_id, owner_user_id, plan_version_id, content_hash, rules_version, status) values ($1, $2, $3, $4, 't', 'completed') returning id`,
      [ORG1, U.studentA, v2, hex64('b')],
    )).rows[0].id);
    await expect(asUser(U.studentA, (c) => c.query(
      `insert into submissions (org_id, owner_user_id, cohort_id, plan_version_id, check_run_id) values ($1, $2, $3, $4, $5)`, [ORG1, U.studentA, COHORT1, v2, staleRun],
    ))).rejects.toThrow(/SUBMISSION_CHECK_STALE/);
  });

  it('requires acknowledgement for a partial check and rules completion', async () => {
    const partial = await admin(async (c) => (await c.query(
      `insert into check_runs (org_id, owner_user_id, plan_version_id, content_hash, rules_version, status, completeness_json)
       values ($1, $2, $3, $4, 't', 'partial', '{"rules":"completed","contextual":"failed"}') returning id`, [ORG1, U.studentA, v2, hex64('d')],
    )).rows[0].id);
    const insert = (ack: boolean) => asUser(U.studentA, (c) => c.query(
      `insert into submissions (org_id, owner_user_id, cohort_id, plan_version_id, check_run_id, acknowledged_incomplete_check) values ($1, $2, $3, $4, $5, $6) returning id`,
      [ORG1, U.studentA, COHORT1, v2, partial, ack],
    ));
    await expect(insert(false)).rejects.toThrow(/SUBMISSION_ACK_REQUIRED/);
    const ok = await insert(true);
    await asUser(U.studentA, (c) => c.query('select app.withdraw_submission($1)', [ok.rows[0].id]));
  });

  it('rejects submitting to a cohort the student is not in, or someone else\'s version', async () => {
    await expect(asUser(U.studentA, (c) => c.query(
      `insert into submissions (org_id, owner_user_id, cohort_id, plan_version_id, check_run_id) values ($1, $2, '00000000-0000-4000-c000-000000000002', $3, $4)`,
      [ORG1, U.studentA, v1, runV1],
    ))).rejects.toThrow(/SUBMISSION_NOT_IN_COHORT|duplicate key/);
    await expect(asUser(U.studentB, (c) => c.query(
      `insert into submissions (org_id, owner_user_id, cohort_id, plan_version_id, check_run_id) values ($1, $2, $3, $4, $5)`,
      [ORG1, U.studentB, COHORT1, v1, runV1],
    ))).rejects.toThrow(/SUBMISSION_NOT_OWNER/);
  });
});

describe('cross-org integrity', () => {
  it('blocks referencing another org\'s rows even with a valid UUID', async () => {
    await expect(asUser(U.studentC, (c) => c.query(
      `insert into plans (org_id, owner_user_id, account_id, title) values ($1, $2, $3, 'x')`, [ORG2, U.studentC, accountId],
    ))).rejects.toThrow(/foreign key|violates/);
    await expect(asUser(U.studentC, (c) => c.query(
      `insert into plans (org_id, owner_user_id, account_id, title) values ($1, $2, $3, 'x')`, [ORG1, U.studentC, accountId],
    ))).rejects.toThrow(/row-level security|foreign key/);
  });
});

describe('withdrawal revokes reviewer access immediately', () => {
  it('reviewer loses the version, check and feedback ability', async () => {
    await asUser(U.studentA, (c) => c.query('select app.withdraw_submission($1)', [submissionId]));
    expect(await rows(U.reviewer, 'select id from plan_versions where id = $1', [v1])).toEqual([]);
    expect(await rows(U.reviewer, 'select id from check_runs where id = $1', [runV1])).toEqual([]);
    expect(await rows(U.reviewer, 'select id from submissions where id = $1', [submissionId])).toEqual([]);
    expect(await rows(U.reviewer, 'select id from feedback where submission_id = $1', [submissionId])).toEqual([]);
    await expect(asUser(U.reviewer, (c) => c.query(`select app.add_feedback($1, 'x', 'comment')`, [submissionId]))).rejects.toThrow(/NOT_FOUND/);
    // The student still owns everything.
    expect(await rows(U.studentA, 'select id from plan_versions where plan_id = $1', [planId])).toHaveLength(2);
  });
});
