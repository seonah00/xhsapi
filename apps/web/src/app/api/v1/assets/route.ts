import { z } from 'zod';
import { AppError } from '@xhs/domain';
import { attachToPlan, attachToReference, getPlan, getReference, MAX_FILES_PER_REQUEST, uploadAsset } from '@xhs/core';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';
import { assetStorage } from '@/server/storage';

const Purpose = z.enum(['reference_image', 'submission_attachment', 'permission_evidence']);

/** Multipart upload: max 5 files, each validated by magic bytes, sanitized and stored privately. */
export const POST = api(async (req) => {
  const form = await req.formData().catch(() => { throw new AppError('VALIDATION_FAILED', '파일 업로드 형식이 올바르지 않습니다.'); });
  const purpose = Purpose.parse(form.get('purpose'));
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new AppError('VALIDATION_FAILED', '파일을 선택하세요.');
  if (files.length > MAX_FILES_PER_REQUEST) throw new AppError('VALIDATION_FAILED', `한 번에 최대 ${MAX_FILES_PER_REQUEST}개까지 올릴 수 있습니다.`);
  const referenceId = form.get('referenceId') ? z.string().uuid().parse(form.get('referenceId')) : null;
  const planId = form.get('planId') ? z.string().uuid().parse(form.get('planId')) : null;
  return withApiCtx(async (ctx) => {
    if (referenceId) await getReference(ctx, referenceId);
    if (planId) await getPlan(ctx, planId);
    const out = [];
    for (const f of files) {
      const a = await uploadAsset(ctx, assetStorage(), { bytes: new Uint8Array(await f.arrayBuffer()), declaredMime: f.type, originalName: f.name, purpose });
      if (referenceId) await attachToReference(ctx, referenceId, a.id);
      if (planId) await attachToPlan(ctx, planId, a.id);
      out.push(a);
    }
    return out;
  });
}, { status: 201 });
