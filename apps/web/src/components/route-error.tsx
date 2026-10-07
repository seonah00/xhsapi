'use client';
import { useEffect } from 'react';
import { unstable_isUnrecognizedActionError } from 'next/navigation';

/**
 * Route error boundary. A page opened before a redeploy still points at the old server actions
 * ("Server Action not found"): nothing was saved or sent, so reload once to pick up the new version.
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const stale = unstable_isUnrecognizedActionError(error);
  useEffect(() => {
    if (!stale) return;
    try {
      // At most one automatic reload per page per minute; a repeat failure shows the message instead of looping.
      const key = `xhs-reloaded:${location.pathname}`;
      if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 60_000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* storage unavailable: still reload once */ }
    location.reload();
  }, [stale]);
  if (stale) {
    return (
      <div role="alert" className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">새 버전이 배포되었습니다</h1>
        <p className="mt-2 text-sm text-muted">방금 누른 요청은 처리되지 않았습니다(비용 없음). 페이지를 새로 불러온 뒤 다시 시도하세요.</p>
        <button onClick={() => location.reload()} className="mt-4 rounded-xl border border-line px-4 py-2 text-sm">새로고침</button>
      </div>
    );
  }
  return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold">일시적인 오류가 발생했습니다</h1>
      <p className="mt-2 text-sm text-muted">잠시 후 다시 시도하세요. 문제가 계속되면 강사·운영자에게 알려 주세요.</p>
      <button onClick={reset} className="mt-4 rounded-xl border border-line px-4 py-2 text-sm">다시 시도</button>
    </div>
  );
}
