import 'server-only';
import { redirect } from 'next/navigation';
import { AppError } from '@xhs/domain';
import { ZodError } from 'zod';

/** Server-action helper: on a known error, redirect back with a Korean message instead of a crash page. */
export async function orRedirectWithError<T>(back: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    const msg = e instanceof AppError ? e.messageKo : e instanceof ZodError ? `입력값을 확인하세요: ${e.issues.map((i) => i.message).slice(0, 3).join(' / ')}` : null;
    if (!msg) throw e;
    const url = new URL(back, 'http://x');
    url.searchParams.set('error', msg);
    redirect(url.pathname + url.search);
  }
}

export { safeLocalPath } from '@xhs/security';
