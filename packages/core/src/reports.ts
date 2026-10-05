import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { notFound, pgCode, type Ctx } from './context.ts';
import { requireStaff } from './staff.ts';

export const ReportInput = z.object({
  targetType: z.enum(['analysis', 'check_finding', 'library_item', 'transcript', 'note']),
  targetId: z.string().uuid(),
  findingIndex: z.number().int().min(0).max(500).optional(),
  reason: z.enum(['incorrect', 'false_positive', 'missed_issue', 'rights_issue', 'source_removed', 'other']),
  note: z.string().trim().max(200).optional(),
});

/** Spec 11: only the result id and a short reason are submitted, never the student's full text. */
export async function createReport(ctx: Ctx, input: unknown): Promise<string> {
  const d = ReportInput.parse(input);
  if (d.targetType === 'library_item') {
    try {
      return (await ctx.db.query<{ id: string }>(`select app.report_library_item($1, $2, $3) as id`, [d.targetId, d.reason, d.note ?? null])).rows[0]!.id;
    } catch (e) {
      if (pgCode(e) === 'NOT_FOUND') notFound();
      throw e;
    }
  }
  const visible = {
    analysis: `select 1 from analyses where id = $1 and owner_user_id = $2`,
    check_finding: `select 1 from check_runs where id = $1 and owner_user_id = $2`,
    transcript: `select 1 from transcript_runs where id = $1 and owner_user_id = $2`,
    note: `select 1 from notes where id = $1 and $2::uuid is not null`,
  }[d.targetType];
  if (!(await ctx.db.query(visible, [d.targetId, ctx.uid])).rowCount) notFound();
  // Reviewers cannot read a student's private check, so the reported rule key is snapshotted here (same order as getCheck).
  const ruleKey = d.targetType === 'check_finding' && d.findingIndex !== undefined
    ? ((await ctx.db.query(`select finding_json ->> 'ruleKey' as k from check_findings where check_run_id = $1 order by field_key, start_utf16 nulls first, id offset $2 limit 1`,
        [d.targetId, d.findingIndex])).rows[0]?.k ?? null)
    : null;
  return (await ctx.db.query<{ id: string }>(
    `insert into result_reports (org_id, reporter_user_id, target_type, target_id, finding_index, rule_key, reason, note) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [ctx.orgId, ctx.uid, d.targetType, d.targetId, d.findingIndex ?? null, ruleKey, d.reason, d.note ?? null],
  )).rows[0]!.id;
}

export type ReportRow = { id: string; targetType: string; targetId: string; findingIndex: number | null; reason: string; note: string | null; status: string; createdAt: string; ruleKey: string | null };

/** Staff queue. For false-positive reports on checks, the rule key is resolved so rules can be tuned. */
export async function listReports(ctx: Ctx, status: 'open' | 'all' = 'open'): Promise<ReportRow[]> {
  requireStaff(ctx);
  return (await ctx.db.query(
    `select r.* from result_reports r where r.org_id = $1 and ($2 = 'all' or r.status = 'open') order by r.created_at desc limit 200`, [ctx.orgId, status],
  )).rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, findingIndex: r.finding_index, reason: r.reason, note: r.note, status: r.status,
    createdAt: r.created_at.toISOString(), ruleKey: r.rule_key }));
}

export async function resolveReport(ctx: Ctx, id: string, status: 'resolved' | 'dismissed'): Promise<void> {
  requireStaff(ctx);
  const r = await ctx.db.query(`update result_reports set status = $3, resolved_by = $4, resolved_at = now() where id = $1 and org_id = $2 and status = 'open'`, [id, ctx.orgId, status, ctx.uid]);
  if (!r.rowCount) throw new AppError('CONFLICT', '이미 처리된 신고입니다.');
}
