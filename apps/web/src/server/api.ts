import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '@xhs/domain';
import { redactString } from '@xhs/security';
import { env } from './env';

/** Wraps a route handler with the spec 8 envelope, error mapping and same-origin checks for writes. */
export function api<P>(handler: (req: NextRequest, params: P) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    const requestId = randomUUID();
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('origin');
        if (!origin || new URL(origin).host !== req.headers.get('host')) {
          throw new AppError('FORBIDDEN', '허용되지 않은 요청 출처입니다.');
        }
      }
      const data = await handler(req, await context.params);
      return NextResponse.json({ data, meta: { requestId, mode: env().APP_DATA_MODE, asOf: new Date().toISOString(), warnings: [], nextCursor: null } }, { status: opts.status ?? 200 });
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'VALIDATION_FAILED' && e instanceof ZodError) {
        return NextResponse.json({ error: { code: err.code, messageKo: err.messageKo, retryable: false, issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, requestId }, { status: err.status });
      }
      if (err.status >= 500 && !(e instanceof AppError)) console.error('api error', requestId, redactString(String(e)));
      return NextResponse.json({ error: { code: err.code, messageKo: err.messageKo, retryable: err.retryable }, requestId }, { status: err.status });
    }
  };
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ZodError) return new AppError('VALIDATION_FAILED', '입력값을 확인하세요.');
  return new AppError('PROVIDER_UNAVAILABLE', '일시적인 오류가 발생했습니다.', true);
}

export async function jsonBody(req: NextRequest): Promise<unknown> {
  if (!req.headers.get('content-type')?.includes('application/json')) throw new AppError('VALIDATION_FAILED', 'JSON 본문이 필요합니다.');
  try {
    return await req.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', 'JSON 형식이 올바르지 않습니다.');
  }
}

export function idempotencyKey(req: NextRequest): string {
  const key = req.headers.get('idempotency-key');
  if (!key || key.length < 8 || key.length > 128) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key 헤더(8~128자)가 필요합니다.');
  return key;
}
