'use client';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold">일시적인 오류가 발생했습니다</h1>
      <p className="mt-2 text-sm text-muted">잠시 후 다시 시도하세요. 문제가 계속되면 강사·운영자에게 알려 주세요.</p>
      <button onClick={reset} className="mt-4 rounded-xl border border-line px-4 py-2 text-sm">다시 시도</button>
    </div>
  );
}
