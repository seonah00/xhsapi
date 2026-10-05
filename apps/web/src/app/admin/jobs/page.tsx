import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cancelJob, listOrgJobs } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, ErrorNotice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '작업' };
const STATES = ['queued', 'running', 'waiting_external', 'succeeded', 'failed', 'cancelled', 'unknown_outcome'];

async function cancel(f: FormData) {
  'use server';
  await orRedirectWithError('/admin/jobs', () => withAdmin((ctx) => cancelJob(ctx, String(f.get('id')))));
  redirect('/admin/jobs');
}

export default async function Jobs({ searchParams }: { searchParams: Promise<{ state?: string; error?: string }> }) {
  const sp = await searchParams;
  const state = STATES.includes(sp.state ?? '') ? sp.state : undefined;
  const jobs = await withAdmin((ctx) => listOrgJobs(ctx, state ? { state } : {}));
  return (
    <>
      <PageHeader title="작업" description="작업 종류·상태·오류 코드만 표시합니다. 입력 내용과 학생 문안은 보이지 않습니다." />
      <ErrorNotice message={sp.error} />
      <nav aria-label="상태 필터" className="mb-3 flex flex-wrap gap-1 text-sm">
        <Link href="/admin/jobs" className={`rounded-lg px-2 py-1 ${!state ? 'bg-accent-soft text-accent' : 'hover:bg-bg'}`}>전체</Link>
        {STATES.map((s) => <Link key={s} href={`/admin/jobs?state=${s}`} className={`rounded-lg px-2 py-1 ${state === s ? 'bg-accent-soft text-accent' : 'hover:bg-bg'}`}>{s}</Link>)}
      </nav>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 font-normal">생성</th><th scope="col" className="font-normal">종류</th><th scope="col" className="font-normal">상태</th><th scope="col" className="font-normal">시도</th><th scope="col" className="font-normal">오류</th><th scope="col" /></tr></thead>
            <tbody>{jobs.map((j) => (
              <tr key={j.id} className="border-b border-line last:border-0">
                <td className="py-1.5 text-xs text-muted">{fmtDate(j.createdAt, true)}</td><td className="font-mono text-xs">{j.kind}</td>
                <td><Badge tone={j.state === 'failed' || j.state === 'unknown_outcome' ? 'accent' : j.state === 'succeeded' ? 'ok' : 'neutral'}>{j.state}</Badge> {j.dataMode === 'mock' && <Badge tone="warn">데모</Badge>}</td>
                <td>{j.attempts}</td><td className="max-w-[220px] truncate font-mono text-xs" title={j.errorCode ?? ''}>{j.errorCode ?? '-'}</td>
                <td>{(j.state === 'queued' || j.state === 'waiting_external') && <form action={cancel}><input type="hidden" name="id" value={j.id} /><button className={btn.small}>취소</button></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
