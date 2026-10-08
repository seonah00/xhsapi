import { AppError } from '@xhs/domain';

export const DICTIONARY_UPLOAD_BODY_LIMIT = 2 * 1024 * 1024 + 64 * 1024;

/** Bound the entire multipart body before parsing, and reject cross-origin writes. */
export async function readDictionaryUpload(req: Request, expectedOrigin: string): Promise<FormData> {
  let sameOrigin = false;
  try {
    const origin = req.headers.get('origin');
    sameOrigin = Boolean(origin && new URL(origin).origin === new URL(expectedOrigin).origin);
  } catch { /* fail closed */ }
  if (!sameOrigin || req.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AppError('FORBIDDEN', '허용되지 않은 요청 출처입니다.');
  }
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new AppError('VALIDATION_FAILED', 'JSON 파일 업로드 형식을 확인하세요.');
  }
  const length = req.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > DICTIONARY_UPLOAD_BODY_LIMIT)) {
    throw new AppError('VALIDATION_FAILED', '업로드 요청은 JSON 2MB와 제한된 양식 정보만 포함할 수 있습니다.');
  }
  const reader = req.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_FAILED', 'JSON 파일을 선택하세요.');
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > DICTIONARY_UPLOAD_BODY_LIMIT) {
        await reader.cancel();
        throw new AppError('VALIDATION_FAILED', '업로드 요청이 허용 크기를 초과했습니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new AppError('VALIDATION_FAILED', '파일 업로드 형식을 읽을 수 없습니다.');
  }
}
