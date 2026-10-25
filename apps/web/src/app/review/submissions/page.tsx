import Link from 'next/link';
import { reviewQueue,listWritingReviews } from '@xhs/core';
import { withStaff } from '@/server/staff';
import { Badge, Empty, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { SUBMISSION_STATUS } from '@/components/plan-labels';

export const metadata = { title: '검토함' };

export default async function ReviewQueue() {
  const {subs,writings} = await withStaff(async ctx => ({subs:await reviewQueue(ctx),writings:await listWritingReviews(ctx)}));
  return (
    <>
      <PageHeader title="검토함" description="배정된 기수 학생이 제출한 버전만 보입니다. 학생의 다른 초안·레퍼런스는 볼 수 없습니다." />
      <h2 className="mb-3 font-semibold">작성물 검토</h2><ul>{writings.filter(v=>v.status==='submitted').map(v=><li key={v.id}><Link className="mb-3 block rounded-xl border border-line p-4" href={`/app/write/reviews/${v.id}`}>{v.snapshot.title||'제목 없는 글'} · 버전 {v.revision}</Link></li>)}</ul><h2 className="my-3 font-semibold">기획 검토</h2>{subs.length === 0 ? <Empty title="검토할 제출이 없습니다">기수에 강사로 배정되어 있어야 제출물이 보입니다.</Empty> : (
        <ul className="space-y-2">
          {subs.map((s) => {
            const [label, tone] = SUBMISSION_STATUS[s.status] ?? [s.status, 'neutral' as const];
            return (
              <li key={s.id}>
                <Link href={`/review/submissions/${s.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-accent">
                  <div className="flex flex-wrap items-center gap-2"><span className="zh font-medium">{s.planTitle || '(제목 없음)'}</span><Badge tone={tone}>{label}</Badge></div>
                  <p className="mt-1 text-sm text-muted">{s.author} · {s.cohortName} · v{s.version} · {fmtDate(s.submittedAt, true)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
