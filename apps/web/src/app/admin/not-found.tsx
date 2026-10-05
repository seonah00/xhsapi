import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold">접근할 수 없는 항목입니다</h1>
      <p className="mt-2 text-sm text-muted">삭제되었거나 볼 권한이 없습니다.</p>
      <Link href="/app" className="mt-4 inline-block text-accent underline">홈으로</Link>
    </div>
  );
}
