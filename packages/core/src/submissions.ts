import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { notFound, pgCode, type Ctx } from './context.ts';
import { getCheck, type CheckRunView } from './checks.ts';
import { FactSheet, PlanContent } from './plans.ts';

const ERR: Record<string, string> = {
  SUBMISSION_NOT_OWNER: '본인 기획만 제출할 수 있습니다.',
  SUBMISSION_PROPOSAL_NOT_APPLIED: 'AI 제안 버전은 적용한 뒤 제출할 수 있습니다.',
  SUBMISSION_NOT_IN_COHORT: '이 기수의 학생이 아닙니다.',
  SUBMISSION_CHECK_NOT_OWNER: '본인 점검 결과만 첨부할 수 있습니다.',
  SUBMISSION_CHECK_STALE: '점검 결과가 이 버전과 맞지 않습니다. 이 버전으로 다시 점검하세요.',
  SUBMISSION_CHECK_INCOMPLETE: '규칙 점검이 완료된 결과만 제출할 수 있습니다.',
  SUBMISSION_ACK_REQUIRED: 'AI 문맥 점검이 완료되지 않았습니다. 누락 범위를 확인했다고 체크해 주세요.',
};

export async function myCohorts(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  return (await ctx.db.query(
    `select c.id, c.name from cohort_members cm join cohorts c on c.id = cm.cohort_id
     where cm.user_id = $1 and cm.org_id = $2 and cm.role = 'student' and cm.status = 'active' and c.status = 'active' order by c.name`, [ctx.uid, ctx.orgId],
  )).rows;
}

export const SubmitInput = z.object({
  planVersionId: z.string().uuid(),
  cohortId: z.string().uuid(),
  checkRunId: z.string().uuid(),
  acknowledgeIncompleteCheck: z.boolean().default(false),
  assetIds: z.array(z.string().uuid()).max(5).default([]),
});

/** Shares exactly one immutable version + its check run with the cohort's reviewers (spec F10). */
export async function submitPlan(ctx: Ctx, input: unknown): Promise<string> {
  const d = SubmitInput.parse(input);
  try {
    const id = (await ctx.db.query<{ id: string }>(
      `insert into submissions (org_id, owner_user_id, cohort_id, plan_version_id, check_run_id, acknowledged_incomplete_check)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [ctx.orgId, ctx.uid, d.cohortId, d.planVersionId, d.checkRunId, d.acknowledgeIncompleteCheck],
    )).rows[0]!.id;
    // Only explicitly selected, shareable attachments of the student (trigger re-validates).
    for (const assetId of new Set(d.assetIds)) {
      await ctx.db.query(`insert into submission_assets (submission_id, asset_id, org_id, shared_by) values ($1, $2, $3, $4)`, [id, assetId, ctx.orgId, ctx.uid]);
    }
    return id;
  } catch (e) {
    const code = pgCode(e);
    if (code && ERR[code]) throw new AppError('VALIDATION_FAILED', ERR[code]);
    if (/submissions_one_active/.test(String(e))) throw new AppError('CONFLICT', '이 버전은 이미 이 기수에 제출되어 있습니다.');
    if (/SUBMISSION_ASSET_NOT_ALLOWED/.test(String(e))) throw new AppError('VALIDATION_FAILED', '공유할 수 없는 첨부가 포함되어 있습니다.');
    throw e;
  }
}

export async function withdrawSubmission(ctx: Ctx, id: string): Promise<void> {
  try {
    await ctx.db.query(`select app.withdraw_submission($1)`, [id]);
  } catch (e) {
    if (pgCode(e) === 'NOT_FOUND') notFound();
    throw e;
  }
}

export type SubmissionRow = {
  id: string; status: string; cohortName: string; planTitle: string | null; version: number; submittedAt: string; withdrawnAt: string | null;
  planId: string | null; latestFeedback: string | null; author: string | null;
};

export async function listMySubmissions(ctx: Ctx, planId?: string): Promise<SubmissionRow[]> {
  return (await ctx.db.query(
    `select s.id, s.status, c.name as cohort_name, p.title, v.version, s.submitted_at, s.withdrawn_at, p.id as plan_id,
            (select f.content from feedback f where f.submission_id = s.id order by f.created_at desc limit 1) as latest
     from submissions s join cohorts c on c.id = s.cohort_id join plan_versions v on v.id = s.plan_version_id join plans p on p.id = v.plan_id
     where s.org_id = $1 and s.owner_user_id = $2 and ($3::uuid is null or p.id = $3) order by s.submitted_at desc`, [ctx.orgId, ctx.uid, planId ?? null],
  )).rows.map((r) => ({ id: r.id, status: r.status, cohortName: r.cohort_name, planTitle: r.title, version: r.version, submittedAt: r.submitted_at.toISOString(),
    withdrawnAt: r.withdrawn_at?.toISOString() ?? null, planId: r.plan_id, latestFeedback: r.latest, author: null }));
}

/** Reviewer queue: only active submissions in cohorts the reviewer is assigned to (RLS). Plans table is never read. */
export async function reviewQueue(ctx: Ctx): Promise<SubmissionRow[]> {
  return (await ctx.db.query(
    `select s.id, s.status, c.name as cohort_name, v.content_json ->> 'title' as title, v.version, s.submitted_at, app.submission_author(s.id) as author,
            (select f.content from feedback f where f.submission_id = s.id order by f.created_at desc limit 1) as latest
     from submissions s join cohorts c on c.id = s.cohort_id join plan_versions v on v.id = s.plan_version_id
     where s.org_id = $1 and s.status <> 'withdrawn' and app.is_cohort_reviewer(s.cohort_id) order by (s.status = 'submitted') desc, s.submitted_at desc`, [ctx.orgId],
  )).rows.map((r) => ({ id: r.id, status: r.status, cohortName: r.cohort_name, planTitle: r.title, version: r.version, submittedAt: r.submitted_at.toISOString(),
    withdrawnAt: null, planId: null, latestFeedback: r.latest, author: r.author }));
}

export type ReviewDetail = {
  id: string; status: string; cohortName: string; author: string | null; submittedAt: string; acknowledgedIncompleteCheck: boolean;
  version: { number: number; content: PlanContent; facts: FactSheet; createdAt: string };
  check: CheckRunView;
  feedback: { id: string; content: string; status: string; reviewer: string; createdAt: string; checklist: string[] }[];
  isOwner: boolean;
  attachments: { id: string; name: string; mime: string }[];
};

export async function getSubmission(ctx: Ctx, id: string): Promise<ReviewDetail> {
  const s = (await ctx.db.query(
    `select s.*, c.name as cohort_name, app.submission_author(s.id) as author from submissions s join cohorts c on c.id = s.cohort_id
     where s.id = $1 and s.org_id = $2`, [id, ctx.orgId],
  )).rows[0];
  if (!s) notFound();
  const isOwner = s.owner_user_id === ctx.uid;
  if (s.status === 'withdrawn' && !isOwner) notFound();
  const v = (await ctx.db.query(`select version, content_json, fact_sheet_json, created_at from plan_versions where id = $1`, [s.plan_version_id])).rows[0];
  if (!v) notFound();
  const feedback = (await ctx.db.query(
    `select f.id, f.content, f.status, f.created_at, f.checklist_json, u.email from feedback f left join lateral (select email from app.member_directory($2) d where d.user_id = f.reviewer_user_id) u on true
     where f.submission_id = $1 order by f.created_at`, [id, ctx.orgId],
  )).rows;
  return {
    id: s.id, status: s.status, cohortName: s.cohort_name, author: s.author, submittedAt: s.submitted_at.toISOString(), acknowledgedIncompleteCheck: s.acknowledged_incomplete_check,
    version: { number: v.version, content: PlanContent.parse(v.content_json), facts: FactSheet.parse(v.fact_sheet_json), createdAt: v.created_at.toISOString() },
    check: await getCheck(ctx, s.check_run_id),
    attachments: (await ctx.db.query(
      `select sa.asset_id as id, m.original_name as name, m.mime from submission_assets sa cross join lateral app.asset_meta(sa.asset_id) m where sa.submission_id = $1`, [id],
    )).rows.map((r) => ({ id: r.id, name: r.name ?? 'file', mime: r.mime })),
    feedback: feedback.map((f) => ({ id: f.id, content: f.content, status: f.status, reviewer: f.email ?? '강사', createdAt: f.created_at.toISOString(), checklist: f.checklist_json ?? [] })),
    isOwner,
  };
}

export async function startReview(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.query(`select app.start_review($1)`, [id]);
}

export const FeedbackInput = z.object({
  content: z.string().trim().min(1).max(10_000),
  status: z.enum(['comment', 'changes_requested', 'feedback_complete']),
  checklist: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

/** Comments/checklist only; never edits the student's text (spec F10). */
export async function addFeedback(ctx: Ctx, submissionId: string, input: unknown): Promise<string> {
  const d = FeedbackInput.parse(input);
  try {
    return (await ctx.db.query<{ id: string }>(`select app.add_feedback($1, $2, $3, $4) as id`, [submissionId, d.content, d.status, JSON.stringify(d.checklist)])).rows[0]!.id;
  } catch (e) {
    if (pgCode(e) === 'NOT_FOUND') notFound();
    throw e;
  }
}
