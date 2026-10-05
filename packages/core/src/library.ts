import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { notFound, pgCode, type Ctx } from './context.ts';
import { getReference } from './references.ts';
import { requireStaff } from './staff.ts';

export const SHARE_POLICY_VERSION = 'reference-share-v1';

/** Student asks to share a reference with the org library; requires explicit consent (spec F05). */
export async function requestSharing(ctx: Ctx, referenceId: string, input: { confirm: boolean }): Promise<void> {
  if (!input.confirm) throw new AppError('VALIDATION_FAILED', '공유 동의 내용을 확인해 주세요.');
  const ref = await getReference(ctx, referenceId);
  if (ref.deletedAt) notFound();
  const consent = (await ctx.db.query<{ id: string }>(
    `insert into consent_records (org_id, user_id, purpose, policy_version, scope) values ($1, $2, 'reference_sharing', $3, $4) returning id`,
    [ctx.orgId, ctx.uid, SHARE_POLICY_VERSION, { referenceId, revision: ref.revision }],
  )).rows[0]!.id;
  await ctx.db.query(`update reference_items set share_requested_at = now(), share_consent_id = $2 where id = $1 and owner_user_id = $3`, [referenceId, consent, ctx.uid]);
}

/** Withdraws consent; all publications of this reference disappear immediately. */
export async function revokeSharing(ctx: Ctx, referenceId: string): Promise<void> {
  try {
    await ctx.db.query(`select app.revoke_reference_sharing($1)`, [referenceId]);
  } catch (e) {
    if (pgCode(e) === 'NOT_FOUND') notFound();
    throw e;
  }
}

export async function sharingStatus(ctx: Ctx, referenceId: string): Promise<{ requested: boolean; published: boolean }> {
  const r = (await ctx.db.query(`select share_requested_at is not null as requested from reference_items where id = $1 and owner_user_id = $2`, [referenceId, ctx.uid])).rows[0];
  if (!r) notFound();
  const pub = await ctx.db.query(`select 1 from reference_publications where source_reference_id = $1 and status = 'published'`, [referenceId]);
  return { requested: r.requested, published: (pub.rowCount ?? 0) > 0 };
}

export type ShareRequest = { referenceId: string; ownerEmail: string; title: string | null; sourceType: string; url: string | null; noteTitle: string | null; memo: string | null; license: string; revision: number; requestedAt: string };

export async function listShareRequests(ctx: Ctx): Promise<ShareRequest[]> {
  requireStaff(ctx);
  return (await ctx.db.query(`select * from app.share_requests($1)`, [ctx.orgId])).rows.map((r) => ({
    referenceId: r.reference_id, ownerEmail: r.owner_email, title: r.title, sourceType: r.source_type, url: r.manual_url, noteTitle: r.note_title, memo: r.user_memo,
    license: r.license_assertion, revision: r.revision, requestedAt: r.requested_at.toISOString(),
  }));
}

/** Creates the immutable snapshot server-side from the current source revision. */
export async function publishReference(ctx: Ctx, referenceId: string, revision: number): Promise<string> {
  requireStaff(ctx);
  try {
    return (await ctx.db.query<{ id: string }>(`select app.publish_reference($1, $2) as id`, [referenceId, revision])).rows[0]!.id;
  } catch (e) {
    const code = pgCode(e);
    if (code === 'STALE_REVISION') throw new AppError('STALE_REVISION', '학생이 자료를 수정했습니다. 새로고침 후 다시 검토하세요.');
    if (code === 'CONSENT_MISSING' || code === 'SHARE_NOT_REQUESTED') throw new AppError('CONFLICT', '공유 동의가 철회되었거나 요청이 없습니다.');
    if (code === 'NOT_FOUND') notFound();
    throw e;
  }
}

export async function unpublishReference(ctx: Ctx, publicationId: string, reason: string): Promise<void> {
  requireStaff(ctx);
  const r = z.string().trim().min(2).max(200).parse(reason);
  try {
    await ctx.db.query(`select app.unpublish_reference($1, $2)`, [publicationId, r]);
  } catch (e) {
    if (pgCode(e) === 'NOT_FOUND') notFound();
    throw e;
  }
}

export type LibraryItem = { id: string; title: string | null; url: string | null; memo: string | null; tags: string[]; sourceType: string; dataMode: string; userText: string | null; publishedAt: string };

export async function listLibrary(ctx: Ctx, q?: string): Promise<LibraryItem[]> {
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return (await ctx.db.query(
    `select id, snapshot_json, published_at from reference_publications where org_id = $1 and status = 'published' and (expires_at is null or expires_at > now())
       and ($2::text is null or snapshot_json::text ilike $2) order by published_at desc limit 200`, [ctx.orgId, like],
  )).rows.map((r) => ({ id: r.id, title: r.snapshot_json.title, url: r.snapshot_json.url, memo: r.snapshot_json.memo, tags: r.snapshot_json.tags ?? [], sourceType: r.snapshot_json.sourceType,
    dataMode: r.snapshot_json.dataMode, userText: r.snapshot_json.userText, publishedAt: r.published_at.toISOString() }));
}
