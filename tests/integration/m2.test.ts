import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addFeedback, applyProposal, createAccount, createDictionaryDraft, createPlan, createQuote, createRule, getPlan, getSubmission,
  listDictionaryForReview, listExpressions, listGenerations, listMySubmissions, listRules, markContextualRequested, reserveJob,
  reviewDictionaryEntry, reviewQueue, reviewRule, runCheck, runJob, saveDraft, saveVersion, setPlanStatus, startReview, submitPlan,
  withdrawSubmission, getCheck, type Ctx, type Runner,
} from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { COHORT1, ORG1, pool, U } from './db.ts';

const service: Runner = async (fn) => {
  const c = await pool.connect();
  try { await c.query('begin'); const out = await fn(c); await c.query('commit'); return out; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
};
async function as<T>(uid: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const role = (await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [ORG1, uid])).rows[0]?.role ?? 'student';
    const out = await fn({ db: c, uid, orgId: ORG1, role, mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const deps = { service, provider: new MockXhsProvider(), pollBaseMs: 0 };
async function drain() {
  for (const id of (await pool.query(`select id from app_jobs where state = 'queued' order by created_at`)).rows.map((r) => r.id)) await runJob(deps, id, 'test');
}
async function aiJob(uid: string, op: 'plan_generation' | 'contextual_check', scope: Record<string, string>, key: string) {
  return as(uid, async (ctx) => {
    const q = await createQuote(ctx, service, op, scope);
    return reserveJob(ctx, { quoteId: q.id, route: `test ${op}`, idempotencyKey: key, operation: op, scope, jobKind: op, dedupeKey: `${op}:${q.id}`, inputRef: scope });
  });
}

let accountId: string;
let planId: string;
const facts = { subject: '敏感肌面霜', confirmedFacts: ['我用了两周', '早晚各一次'], shootableScenes: ['洗手台上涂抹', '质地特写'], sponsorship: 'no' as const };

beforeAll(async () => {
  accountId = await as(U.studentA, (ctx) => createAccount(ctx, {
    displayName: 'M2 계정', topics: ['beauty'], mainTopic: 'beauty', audience: '중국어 사용자', goals: ['learn_chinese'], tone: 'friendly',
    formats: ['vlog'], chineseLevel: 'intermediate', showFace: true, useVoice: true,
  }));
});
afterAll(async () => { await pool.end(); });

describe('plans: draft autosave, versions, ownership', () => {
  it('creates a plan with version 1 and keeps drafts private', async () => {
    planId = await as(U.studentA, (ctx) => createPlan(ctx, { accountId, title: '면크림 기획' }));
    const p = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    expect(p.versions.map((v) => v.version)).toEqual([1]);
    for (const uid of [U.studentB, U.reviewer, U.admin]) await expect(as(uid, (ctx) => getPlan(ctx, planId))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('autosave uses revisions; a stale write is a conflict and does not create versions', async () => {
    const p = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    const r = await as(U.studentA, (ctx) => saveDraft(ctx, planId, { content: { title: '敏感肌面霜｜最好用', body: '我用了两周，最好用！' }, facts }, p.revision));
    await expect(as(U.studentA, (ctx) => saveDraft(ctx, planId, { content: {}, facts }, p.revision))).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect((await as(U.studentA, (ctx) => getPlan(ctx, planId))).versions).toHaveLength(1);
    const v = await as(U.studentA, (ctx) => saveVersion(ctx, planId, r.revision));
    expect(v.version).toBe(2);
    // Saving again without changes returns the same version.
    const p2 = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    expect((await as(U.studentA, (ctx) => saveVersion(ctx, planId, p2.revision))).id).toBe(v.id);
  });

  it('status is set by the student only', async () => {
    await as(U.studentA, (ctx) => setPlanStatus(ctx, planId, 'filming'));
    await expect(as(U.studentA, (ctx) => setPlanStatus(ctx, planId, 'approved'))).rejects.toThrow();
  });
});

describe('mock plan generation', () => {
  it('returns questions when facts are missing, without creating a version', async () => {
    const other = await as(U.studentA, (ctx) => createPlan(ctx, { accountId, title: '사실 없는 기획' }));
    await aiJob(U.studentA, 'plan_generation', { planId: other }, 'idem-gen-0001');
    await drain();
    const gens = await as(U.studentA, (ctx) => listGenerations(ctx, other));
    expect(gens[0]?.output.kind).toBe('questions');
    expect((await as(U.studentA, (ctx) => getPlan(ctx, other))).versions.every((v) => v.kind === 'edit')).toBe(true);
  });

  it('creates a separate proposal version; applying it is explicit', async () => {
    await aiJob(U.studentA, 'plan_generation', { planId }, 'idem-gen-0002');
    await drain();
    const gens = await as(U.studentA, (ctx) => listGenerations(ctx, planId));
    const proposalId = gens[0]!.proposalVersionId!;
    const before = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    expect(before.draft.content.title).toBe('敏感肌面霜｜最好用'); // draft untouched
    const proposal = before.versions.find((v) => v.id === proposalId)!;
    expect(proposal.kind).toBe('ai_proposal');
    expect(proposal.content.body).toContain('我用了两周');
    const applied = await as(U.studentA, (ctx) => applyProposal(ctx, planId, proposalId, before.revision));
    expect(applied.kind).toBe('edit');
    expect((await as(U.studentA, (ctx) => getPlan(ctx, planId))).draft.content.body).toBe(proposal.content.body);
  });
});

describe('checks and submission', () => {
  let versionId: string;
  let checkId: string;

  it('runs rule checks on a saved version with anchored findings', async () => {
    const p = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    await as(U.studentA, (ctx) => saveDraft(ctx, planId, { content: { title: '敏感肌面霜｜最好用', body: '我用了两周，最好用！电话13812345678' }, facts }, p.revision));
    const p2 = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    versionId = (await as(U.studentA, (ctx) => saveVersion(ctx, planId, p2.revision))).id;
    checkId = await as(U.studentA, (ctx) => runCheck(ctx, service, {}, { planId, versionId }));
    const check = await as(U.studentA, (ctx) => getCheck(ctx, checkId));
    expect(check.status).toBe('completed');
    expect(check.findings.map((f) => f.type)).toEqual(expect.arrayContaining(['absolute_or_exaggerated_claim', 'personal_information']));
    expect(check.findings.find((f) => f.type === 'personal_information')?.originalSpan).toBe('13812345678');
  });

  it('rejects a check from another version (stale) and submits the matching one', async () => {
    const older = (await as(U.studentA, (ctx) => getPlan(ctx, planId))).versions.find((v) => v.kind === 'edit' && v.id !== versionId)!;
    await expect(as(U.studentA, (ctx) => submitPlan(ctx, { planVersionId: older.id, cohortId: COHORT1, checkRunId: checkId }))).rejects.toMatchObject({ messageKo: expect.stringContaining('다시 점검') });
    const sub = await as(U.studentA, (ctx) => submitPlan(ctx, { planVersionId: versionId, cohortId: COHORT1, checkRunId: checkId }));
    expect((await as(U.studentA, (ctx) => listMySubmissions(ctx))).find((s) => s.id === sub)?.status).toBe('submitted');

    // Reviewer of cohort 1 sees it (with author), other reviewer/students do not.
    const queue = await as(U.reviewer, (ctx) => reviewQueue(ctx));
    expect(queue.find((s) => s.id === sub)).toMatchObject({ author: 'student-a@demo.invalid', planTitle: '敏感肌面霜｜最好用' });
    expect((await as(U.reviewerOther, (ctx) => reviewQueue(ctx))).some((s) => s.id === sub)).toBe(false);
    await expect(as(U.studentB, (ctx) => getSubmission(ctx, sub))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await as(U.reviewer, (ctx) => startReview(ctx, sub));
    const detail = await as(U.reviewer, (ctx) => getSubmission(ctx, sub));
    expect(detail.status).toBe('in_review');
    expect(detail.check.findings.length).toBeGreaterThan(0);
    await as(U.reviewer, (ctx) => addFeedback(ctx, sub, { content: '전화번호를 지우세요', status: 'changes_requested', checklist: ['개인정보 삭제'] }));
    const mine = await as(U.studentA, (ctx) => getSubmission(ctx, sub));
    expect(mine.feedback[0]).toMatchObject({ content: '전화번호를 지우세요', status: 'changes_requested', checklist: ['개인정보 삭제'] });
    // Feedback never changes the plan status.
    expect((await as(U.studentA, (ctx) => getPlan(ctx, planId))).status).toBe('filming');

    await as(U.studentA, (ctx) => withdrawSubmission(ctx, sub));
    await expect(as(U.reviewer, (ctx) => getSubmission(ctx, sub))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('partial check (AI layer failed) needs acknowledgement', async () => {
    const p = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    await as(U.studentA, (ctx) => saveDraft(ctx, planId, { content: { title: '敏感肌面霜', body: '我用了两周 MOCK_AI_FAIL' }, facts }, p.revision));
    const p2 = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    const v = (await as(U.studentA, (ctx) => saveVersion(ctx, planId, p2.revision))).id;
    const run = await as(U.studentA, (ctx) => runCheck(ctx, service, {}, { planId, versionId: v }));
    await markContextualRequested(service, run);
    await aiJob(U.studentA, 'contextual_check', { checkRunId: run }, 'idem-ctx-0001');
    await drain();
    const check = await as(U.studentA, (ctx) => getCheck(ctx, run));
    expect(check).toMatchObject({ status: 'partial', completeness: { rules: 'completed', contextual: 'failed' } });
    await expect(as(U.studentA, (ctx) => submitPlan(ctx, { planVersionId: v, cohortId: COHORT1, checkRunId: run }))).rejects.toMatchObject({ messageKo: expect.stringContaining('누락 범위') });
    await as(U.studentA, (ctx) => submitPlan(ctx, { planVersionId: v, cohortId: COHORT1, checkRunId: run, acknowledgeIncompleteCheck: true }));
  });

  it('a successful contextual layer completes the run', async () => {
    const p = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    await as(U.studentA, (ctx) => saveDraft(ctx, planId, { content: { title: '首尔咖啡推荐', body: '今天讲护肤顺序', tags: ['育儿日常'] }, facts }, p.revision));
    const p2 = await as(U.studentA, (ctx) => getPlan(ctx, planId));
    const v = (await as(U.studentA, (ctx) => saveVersion(ctx, planId, p2.revision))).id;
    const run = await as(U.studentA, (ctx) => runCheck(ctx, service, {}, { planId, versionId: v }));
    await markContextualRequested(service, run);
    await aiJob(U.studentA, 'contextual_check', { checkRunId: run }, 'idem-ctx-0002');
    await drain();
    const check = await as(U.studentA, (ctx) => getCheck(ctx, run));
    expect(check.status).toBe('completed');
    expect(check.findings.filter((f) => f.layer === 'contextual').map((f) => f.type).sort()).toEqual(['title_body_mismatch', 'unrelated_tag']);
  });
});

describe('staff: dictionary review and editorial rules', () => {
  it('students cannot use staff tools', async () => {
    await expect(as(U.studentA, (ctx) => listRules(ctx))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as(U.studentA, (ctx) => listDictionaryForReview(ctx))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('dictionary entries need a reviewer check before publishing; students see only published', async () => {
    const id = await as(U.reviewer, (ctx) => createDictionaryDraft(ctx, { expression: '氛围感', meaning: '분위기 있는 느낌', avoid: '과장 광고' }));
    expect((await as(U.studentA, (ctx) => listExpressions(ctx, { q: '氛围感' }))).length).toBe(0);
    await expect(as(U.reviewer, (ctx) => reviewDictionaryEntry(ctx, id, 'published'))).rejects.toMatchObject({ code: 'CONFLICT' });
    await as(U.reviewer, (ctx) => reviewDictionaryEntry(ctx, id, 'reviewer_checked'));
    await as(U.admin, (ctx) => reviewDictionaryEntry(ctx, id, 'published'));
    expect((await as(U.studentA, (ctx) => listExpressions(ctx, { q: '氛围感' })))[0]).toMatchObject({ reviewStatus: 'published', personal: false });
  });

  it('org rules start as draft, official classes need sources, active rules apply to checks', async () => {
    await expect(as(U.reviewer, (ctx) => createRule(ctx, { ruleKey: 'BAD KEY', matchType: 'keyword', value: 'x', fields: ['body'], findingType: 'source_uncertain', severity: 'low', rationale: '설명입니다' }))).rejects.toThrow();
    const official = await as(U.reviewer, (ctx) => createRule(ctx, { ruleKey: 'law-cure', matchType: 'keyword', value: '根治', fields: ['body'], findingType: 'unsupported_health_claim', severity: 'high', rationale: '치료 단정 표현', sourceClass: 'official_policy' }));
    await expect(as(U.reviewer, (ctx) => reviewRule(ctx, official, 'activate'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const id = await as(U.reviewer, (ctx) => createRule(ctx, { ruleKey: 'no-shenqi', matchType: 'keyword', value: '神器', fields: ['title', 'body'], findingType: 'absolute_or_exaggerated_claim', severity: 'medium', rationale: '과장으로 읽힐 수 있는 표현입니다', suggestionZh: '好用的小工具' }));
    const draftRun = await as(U.studentA, (ctx) => runCheck(ctx, service, { sections: { title: '护肤神器' }, facts: { sponsorship: 'no' } }));
    expect((await as(U.studentA, (ctx) => getCheck(ctx, draftRun))).findings.some((f) => f.ruleKey?.startsWith('no-shenqi'))).toBe(false);
    await as(U.reviewer, (ctx) => reviewRule(ctx, id, 'activate'));
    const run = await as(U.studentA, (ctx) => runCheck(ctx, service, { sections: { title: '护肤神器' }, facts: { sponsorship: 'no' } }));
    const f = (await as(U.studentA, (ctx) => getCheck(ctx, run))).findings.find((x) => x.ruleKey === 'no-shenqi@1');
    expect(f).toMatchObject({ start: 2, end: 4, suggestionZh: '好用的小工具', reviewOverdue: false });
    const listed = (await as(U.admin, (ctx) => listRules(ctx))).find((r) => r.id === id);
    expect(listed?.reviewDueAt).not.toBeNull();
  });

  it('cannot change built-in (global) rules', async () => {
    const globalId = (await pool.query(`select id from check_rules where org_id is null limit 1`)).rows[0].id;
    await expect(as(U.admin, (ctx) => reviewRule(ctx, globalId, 'retire'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
