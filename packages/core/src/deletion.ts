import { AppError } from '@xhs/domain';
import type { Ctx, Db } from './context.ts';
import type { ObjectStorage } from './storage.ts';

export const DELETE_CONFIRM_TEXT = '내 데이터를 삭제합니다';

export type DeletionRow = { id: string; scope: string; state: string; requestedAt: string; completedAt: string | null; exceptionReason: string | null; summary: Record<string, number> | null };

/**
 * Spec 10.4: access is blocked immediately (library sharing revoked, active
 * submissions withdrawn), then a job deletes stored data. Cost ledger and
 * security audit rows are retained under their own retention policy.
 */
export async function requestDeletion(ctx: Ctx, confirmText: string): Promise<string> {
  if (confirmText.trim() !== DELETE_CONFIRM_TEXT) throw new AppError('VALIDATION_FAILED', `확인 문구를 정확히 입력하세요: ${DELETE_CONFIRM_TEXT}`);
  const open = await ctx.db.query(`select 1 from deletion_requests where owner_user_id = $1 and org_id = $2 and state in ('requested', 'access_blocked')`, [ctx.uid, ctx.orgId]);
  if (open.rowCount) throw new AppError('CONFLICT', '이미 처리 중인 삭제 요청이 있습니다.');
  return createBlockedRequest(ctx, 'all_my_data');
}

export const LEAVE_CONFIRM_TEXT = '조직에서 나갑니다';

/**
 * Voluntary leave (F01): the same immediate blocking as a deletion request, then the
 * membership becomes 'left' in the same transaction. The last active admin cannot leave.
 * The caller enqueues the deletion job with service rights afterwards.
 */
export async function leaveOrganization(ctx: Ctx, confirmText: string): Promise<string> {
  if (confirmText.trim() !== LEAVE_CONFIRM_TEXT) throw new AppError('VALIDATION_FAILED', `확인 문구를 정확히 입력하세요: ${LEAVE_CONFIRM_TEXT}`);
  const id = await createBlockedRequest(ctx, 'leave_org');
  try {
    await ctx.db.query(`select app.leave_org($1)`, [ctx.orgId]);
  } catch (e) {
    if (/LAST_ADMIN/.test(String(e))) throw new AppError('CONFLICT', '마지막 관리자는 나갈 수 없습니다. 다른 관리자를 먼저 지정하세요.');
    throw e;
  }
  return id;
}

async function createBlockedRequest(ctx: Ctx, scope: 'all_my_data' | 'leave_org'): Promise<string> {
  const id = (await ctx.db.query<{ id: string }>(
    `insert into deletion_requests (org_id, owner_user_id, scope, state) values ($1, $2, $3, 'requested') returning id`, [ctx.orgId, ctx.uid, scope],
  )).rows[0]!.id;
  for (const r of (await ctx.db.query<{ id: string }>(`select id from reference_items where owner_user_id = $1 and org_id = $2 and share_requested_at is not null`, [ctx.uid, ctx.orgId])).rows) {
    await ctx.db.query(`select app.revoke_reference_sharing($1)`, [r.id]);
  }
  for (const s of (await ctx.db.query<{ id: string }>(`select id from submissions where owner_user_id = $1 and org_id = $2 and status <> 'withdrawn'`, [ctx.uid, ctx.orgId])).rows) {
    await ctx.db.query(`select app.withdraw_submission($1)`, [s.id]);
  }
  return id;
}

export async function listMyDeletionRequests(ctx: Ctx): Promise<DeletionRow[]> {
  return (await ctx.db.query(`select * from deletion_requests where owner_user_id = $1 and org_id = $2 order by requested_at desc`, [ctx.uid, ctx.orgId])).rows.map((r) => ({
    id: r.id, scope: r.scope, state: r.state, requestedAt: r.requested_at.toISOString(), completedAt: r.completed_at?.toISOString() ?? null, exceptionReason: r.exception_reason, summary: r.summary,
  }));
}

/** Service-side mark after the immediate blocking step (owners cannot set states themselves). */
export async function enqueueDeletion(db: Db, requestId: string): Promise<void> {
  const r = (await db.query(`update deletion_requests set state = 'access_blocked' where id = $1 and state = 'requested' returning org_id, owner_user_id`, [requestId])).rows[0];
  if (!r) return;
  const job = (await db.query<{ id: string }>(
    `insert into app_jobs (org_id, owner_user_id, kind, data_mode, input_ref, dedupe_key) values ($1, $2, 'user_deletion', 'mock', $3, $4) returning id`,
    [r.org_id, r.owner_user_id, { deletionRequestId: requestId }, `user_deletion:${requestId}`],
  )).rows[0]!.id;
  await db.query(`update deletion_requests set job_id = $2 where id = $1`, [requestId, job]);
}

/** Deletes the user's stored data in this org (worker, service role, one transaction). */
export async function processDeletion(db: Db, storage: ObjectStorage | null, requestId: string): Promise<Record<string, number>> {
  const req = (await db.query(`select * from deletion_requests where id = $1 and state = 'access_blocked'`, [requestId])).rows[0];
  if (!req) throw new Error('deletion request not in access_blocked state');
  const org = req.org_id as string;
  const uid = req.owner_user_id as string;
  await db.query(`select set_config('app.allow_purge', 'on', true)`);
  const summary: Record<string, number> = {};
  const del = async (label: string, sql: string) => { summary[label] = (await db.query(sql, [org, uid])).rowCount ?? 0; };

  await del('search_requests', `delete from search_requests where org_id=$1 and user_id=$2`);
  await del('submissions', `delete from submissions where org_id = $1 and owner_user_id = $2`);
  await del('check_runs', `delete from check_runs where org_id = $1 and owner_user_id = $2`);
  await del('publications_results', `delete from publication_records where org_id = $1 and owner_user_id = $2`);
  await del('plans', `delete from plans where org_id = $1 and owner_user_id = $2`);
  await del('transcripts', `delete from transcript_runs where org_id = $1 and owner_user_id = $2`);
  await del('analyses', `delete from analyses where org_id = $1 and owner_user_id = $2`);
  await del('library_snapshots', `delete from reference_publications where org_id = $1 and source_owner_user_id = $2`);
  await del('references', `delete from reference_items where org_id = $1 and owner_user_id = $2`);
  await del('collections', `delete from collections where org_id = $1 and owner_user_id = $2`);
  await del('saves', `delete from personal_saves where org_id = $1 and owner_user_id = $2`);
  await del('personal_expressions', `delete from expressions where org_id = $1 and owner_user_id = $2`);
  await del('reference_accounts', `delete from reference_accounts where org_id = $1 and owner_user_id = $2`);
  await del('accounts', `delete from creator_accounts where org_id = $1 and owner_user_id = $2`);
  // Evidence files referenced by provider permission records are retained (contract evidence).
  const removed = (await db.query<{ storage_key: string }>(
    `delete from assets where org_id = $1 and owner_user_id = $2 and not exists (select 1 from provider_permissions p where p.evidence_private_file_id = assets.id) returning storage_key`, [org, uid],
  )).rows.map((r) => r.storage_key);
  summary.assets = removed.length;
  await del('idempotency_keys', `delete from idempotency_keys where org_id = $1 and owner_user_id = $2 and not holds_paid_work`);
  await db.query(`update app_jobs set input_ref = '{}'::jsonb, result_ref = null where org_id = $1 and owner_user_id = $2`, [org, uid]);
  await db.query(`update consent_records set withdrawn_at = coalesce(withdrawn_at, now()) where org_id = $1 and user_id = $2`, [org, uid]);
  for (const k of removed) await storage?.remove(k);
  await db.query(
    `update deletion_requests set state = 'partially_retained', completed_at = now(), summary = $2,
       exception_reason = '비용 원장·보안 감사 기록은 회계·보안 보존 정책(기본 90일)에 따라 유지됩니다. 학생 문안은 포함되지 않습니다.' where id = $1`,
    [requestId, summary],
  );
  return summary;
}

/** Periodic expiry (spec 10.4): expired provider content, transcripts and idempotency keys. */
export async function purgeExpired(db: Db): Promise<Record<string, number>> {
  await db.query(`select set_config('app.allow_purge', 'on', true)`);
  const n = async (sql: string) => (await db.query(sql)).rowCount ?? 0;
  return {
    noteAccessLinks: await n(`delete from note_access_links where expires_at<=now()`),
    noteEnrichments: await n(`delete from note_enrichments where expires_at <= now()`),
    notes: await n(`delete from notes where expires_at is not null and expires_at < now() and not exists (select 1 from reference_items r where r.note_id = notes.id)`),
    transcripts: await n(`delete from transcript_runs where expires_at is not null and expires_at < now()`),
    idempotency: await n(`delete from idempotency_keys where expires_at < now() and not holds_paid_work`),
    quotes: await n(`delete from cost_quotes where consumed_at is null and expires_at < now() - interval '1 day' and not exists (select 1 from usage_ledger l where l.quote_id = cost_quotes.id)`),
  };
}
