import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createCohort, listCohorts } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, Empty, ErrorNotice, input, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '기수' };

async function create(f: FormData) {
  'use server';
  const id = await orRedirectWithError('/admin/cohorts', () => withAdmin((ctx) => createCohort(ctx, String(f.get('name') ?? ''))));
  redirect(`/admin/cohorts/${id}`);
}

export default async function Cohorts({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const cohorts = await withAdmin((ctx) => listCohorts(ctx));
  return (
    <>
      <PageHeader title="기수" description="기수에 배정된 강사는 그 기수 학생이 제출한 버전만 함께 검토합니다(공동 검수함)." />
      <ErrorNotice message={error} />
      <Card className="mb-6">
        <form action={create} className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="cname">기수 이름</label>
          <input id="cname" name="name" required maxLength={80} placeholder="예: 2026 겨울 1기" className={`${input} max-w-sm`} />
          <button className={btn.primary}>기수 만들기</button>
        </form>
      </Card>
      {cohorts.length === 0 ? <Empty title="기수가 없습니다" /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cohorts.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/cohorts/${c.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-accent">
                <div className="flex items-center gap-2"><p className="font-semibold">{c.name}</p>{c.status === 'archived' && <Badge tone="warn">보관됨</Badge>}</div>
                <p className="mt-1 text-sm text-muted">학생 {c.students}명 · 강사 {c.reviewers}명 · {fmtDate(c.createdAt)} 생성</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
