import { NextResponse } from 'next/server';
import { AppError } from '@xhs/domain';
import { normalizeDictionaryImport, readDictionaryUpload, stageDictionaryImport } from '@xhs/core';
import { env } from '@/server/env';
import { ZodError } from 'zod';
import { withAdmin } from '../../forbidden-guard';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

// Relative Location: behind Railway's proxy req.url carries the internal host,
// which made the browser follow a cross-origin redirect and fail.
function seeOther(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function backWithError(_req: Request, message: string) {
  return seeOther(`/admin/dictionary?${new URLSearchParams({ error: message })}`);
}

export async function POST(req: Request) {
  try {
    const id = await withAdmin(async (ctx) => {
      const form = await readDictionaryUpload(req, env().APP_BASE_URL ?? new URL(req.url).origin);
      const file = form.get('dictionaryFile');
      if (!(file instanceof File) || file.size === 0) throw new AppError('VALIDATION_FAILED', 'JSON 파일을 선택하세요.');
      if (file.size > MAX_JSON_BYTES) throw new AppError('VALIDATION_FAILED', 'JSON 파일은 2MB 이하여야 합니다.');
      if (!file.name.toLowerCase().endsWith('.json')) throw new AppError('VALIDATION_FAILED', 'JSON 파일만 업로드할 수 있습니다.');

      let payload: unknown;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new AppError('VALIDATION_FAILED', '올바른 JSON 파일이 아닙니다.');
      }
      // Validate before storing. Only the normalized preview is ever rendered back to a browser.
      normalizeDictionaryImport(payload);
      const label = String(form.get('label') ?? '').trim() || file.name.replace(/\.json$/i, '');
      return stageDictionaryImport(ctx, { label, payload });
    });
    return seeOther(`/admin/dictionary/${id}?staged=1`);
  } catch (error) {
    if ((error as { digest?: string })?.digest) throw error;
    if (error instanceof AppError) return backWithError(req, error.messageKo);
    if (error instanceof ZodError) return backWithError(req, 'JSON 항목 형식을 확인하세요.');
    // Database errors can contain the failing row. Never log raw import contents.
    const code = (error as { code?: unknown })?.code;
    console.error('dictionary import failed', typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN');
    return backWithError(req, '사전을 저장하지 못했습니다. 파일 형식과 크기를 확인한 뒤 다시 시도하세요.');
  }
}
