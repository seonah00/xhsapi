import Link from 'next/link';
import { listMySubmissions } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { Badge, Empty, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { SUBMISSION_STATUS } from '@/components/plan-labels';

export const metadata = { title: '내 제출' };

export default async function MySubmissions() {
  const subs = await withPageCtx((ctx) => listMySubmissions(ctx));
  return (
    <>
      <PageHeader title="내 제출" description="강사는 제출한 버전과 점검 결과만 볼 수 있습니다. 철회하면 즉시 볼 수 없습니다." />
      {subs.length === 0 ? <Empty title="제출한 기획이 없습니다">기획실에서 버전을 점검한 뒤 제출하세요.</Empty> : (
        <ul className="space-y-2">
          {subs.map((s) => {
            const [label, tone] = SUBMISSION_STATUS[s.status] ?? [s.status, 'neutral' as const];
            return (
              <li key={s.id}>
                <Link href={`/app/submissions/${s.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-accent">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{s.planTitle}</span><span className="text-sm text-muted">v{s.version} · {s.cohortName}</span><Badge tone={tone}>{label}</Badge></div>
                  {s.latestFeedback && <p className="mt-1 line-clamp-2 text-sm text-muted">최근 피드백: {s.latestFeedback}</p>}
                  <p className="mt-1 text-xs text-muted">{fmtDate(s.submittedAt, true)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
