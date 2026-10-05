import { randomUUID } from 'node:crypto';
import { AppError, sha256Hex } from '@xhs/domain';
import { FileRejectedError, inspectUpload, safeFileName, type SafeMime } from '@xhs/security';
import { notFound, type Ctx } from './context.ts';
import type { ObjectStorage } from './storage.ts';

export type AssetPurpose = 'reference_image' | 'submission_attachment' | 'permission_evidence' | 'result_attachment';
const IMAGES: SafeMime[] = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED: Record<AssetPurpose, SafeMime[]> = {
  reference_image: IMAGES, submission_attachment: IMAGES, result_attachment: IMAGES, permission_evidence: [...IMAGES, 'application/pdf'],
};
export const MAX_FILES_PER_REQUEST = 5;

const REJECT_KO: Record<FileRejectedError['reason'], string> = {
  too_large: '파일은 10MB 이하만 올릴 수 있습니다.',
  empty: '빈 파일입니다.',
  unsupported_type: '허용되지 않는 형식입니다(JPG·PNG·WebP, 증빙은 PDF 가능). SVG·HTML·실행 파일은 받지 않습니다.',
  type_mismatch: '파일 내용과 형식이 일치하지 않습니다.',
  corrupt: '손상된 이미지입니다.',
  too_many_pixels: '이미지 해상도가 너무 큽니다(최대 8000×8000).',
};

export type AssetRow = { id: string; mime: string; sizeBytes: number; purpose: AssetPurpose; originalName: string | null; width: number | null; height: number | null; rightsScope: string; createdAt: string };

/**
 * Validates, strips metadata, stores privately and records the asset (owner-only).
 * There is no public URL; reads go through the authenticated gateway.
 */
export async function uploadAsset(ctx: Ctx, storage: ObjectStorage, input: { bytes: Uint8Array; declaredMime: string; originalName: string; purpose: AssetPurpose }): Promise<AssetRow> {
  if (input.purpose === 'permission_evidence' && ctx.role !== 'org_admin') throw new AppError('FORBIDDEN', '증빙 파일은 조직 관리자만 올릴 수 있습니다.');
  let file;
  try {
    file = inspectUpload(input.bytes, input.declaredMime, ALLOWED[input.purpose]);
  } catch (e) {
    if (e instanceof FileRejectedError) throw new AppError('VALIDATION_FAILED', REJECT_KO[e.reason]);
    throw e;
  }
  const id = randomUUID();
  const key = `${ctx.orgId}/${id}`;
  await storage.put(key, file.bytes);
  const rights = input.purpose === 'submission_attachment' ? 'shareable_with_reviewer' : 'owner_only';
  const row = (await ctx.db.query(
    `insert into assets (id, org_id, owner_user_id, storage_key, mime, size_bytes, sha256, origin, rights_scope, state, purpose, original_name, width, height, metadata_stripped)
     values ($1, $2, $3, $4, $5, $6, $7, 'user_upload', $8, 'ready', $9, $10, $11, $12, $13) returning created_at`,
    [id, ctx.orgId, ctx.uid, key, file.mime, file.bytes.length, sha256Hex(Buffer.from(file.bytes).toString('latin1')), rights, input.purpose,
     safeFileName(input.originalName), file.width, file.height, file.metadataStripped],
  ).catch(async (e) => { await storage.remove(key); throw e; })).rows[0];
  return { id, mime: file.mime, sizeBytes: file.bytes.length, purpose: input.purpose, originalName: safeFileName(input.originalName), width: file.width, height: file.height, rightsScope: rights, createdAt: row.created_at.toISOString() };
}

/** Gateway read: re-authorizes on every request (owner, active-submission reviewer, or admin for evidence). */
export async function readAsset(ctx: Ctx, storage: ObjectStorage, id: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const meta = (await ctx.db.query<{ storage_key: string; mime: string; original_name: string | null }>(`select * from app.asset_meta($1)`, [id])).rows[0];
  if (!meta) notFound();
  return { bytes: await storage.get(meta.storage_key), mime: meta.mime, name: meta.original_name ?? 'file' };
}

export async function listMyAssets(ctx: Ctx, purpose: AssetPurpose): Promise<AssetRow[]> {
  return (await ctx.db.query(
    `select * from assets where org_id = $1 and owner_user_id = $2 and purpose = $3 and deleted_at is null order by created_at desc`, [ctx.orgId, ctx.uid, purpose],
  )).rows.map(toRow);
}

function toRow(r: Record<string, any>): AssetRow {
  return { id: r.id, mime: r.mime, sizeBytes: r.size_bytes, purpose: r.purpose, originalName: r.original_name, width: r.width, height: r.height, rightsScope: r.rights_scope, createdAt: r.created_at.toISOString() };
}

/** Soft-delete + remove bytes. Linked publications/submissions lose access immediately. */
export async function deleteAsset(ctx: Ctx, storage: ObjectStorage, id: string): Promise<void> {
  const r = (await ctx.db.query(`update assets set deleted_at = now() where id = $1 and owner_user_id = $2 and deleted_at is null returning storage_key`, [id, ctx.uid])).rows[0];
  if (!r) notFound();
  await storage.remove(r.storage_key);
}

export async function attachToReference(ctx: Ctx, referenceId: string, assetId: string): Promise<void> {
  await ctx.db.query(`insert into reference_assets (reference_id, asset_id, org_id) values ($1, $2, $3) on conflict do nothing`, [referenceId, assetId, ctx.orgId]);
}
export async function referenceAssets(ctx: Ctx, referenceId: string): Promise<AssetRow[]> {
  return (await ctx.db.query(`select a.* from reference_assets ra join assets a on a.id = ra.asset_id where ra.reference_id = $1 and a.deleted_at is null order by a.created_at`, [referenceId])).rows.map(toRow);
}
export async function attachToPlan(ctx: Ctx, planId: string, assetId: string): Promise<void> {
  await ctx.db.query(`insert into plan_assets (plan_id, asset_id, org_id) values ($1, $2, $3) on conflict do nothing`, [planId, assetId, ctx.orgId]);
}
export async function planAssets(ctx: Ctx, planId: string): Promise<AssetRow[]> {
  return (await ctx.db.query(`select a.* from plan_assets pa join assets a on a.id = pa.asset_id where pa.plan_id = $1 and a.deleted_at is null order by a.created_at`, [planId])).rows.map(toRow);
}
