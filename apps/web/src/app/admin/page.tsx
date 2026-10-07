import Link from 'next/link';
import { adminOverview } from '@xhs/core';
import { withAdmin } from './forbidden-guard';
import { Card, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { ACTION_LABEL } from './labels';

export const metadata = { title: '관리자' };

export default async function AdminHome() {
  const o = await withAdmin((ctx) => adminOverview(ctx));
  const stats: [string, number, string][] = [
    ['학생', o.students, '/admin/members'], ['강사', o.reviewers, '/admin/members'], ['관리자', o.admins, '/admin/members'],
    ['중지된 멤버', o.suspended, '/admin/members'], ['활성 기수', o.cohorts, '/admin/cohorts'], ['사용 가능한 초대', o.open_invitations, '/admin/invitations'],
  ];
  return (
    <>
      <PageHeader title="관리자 개요" description="조직의 멤버·기수·초대를 관리합니다. 학생의 비공개 초안과 자료는 관리자도 볼 수 없습니다." />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, n, href]) => (
          <div key={label} className="relative rounded-2xl border border-line bg-surface p-4 hover:border-accent">
            <dt className="text-xs text-muted"><Link href={href} className="after:absolute after:inset-0">{label}</Link></dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <Card className="mt-6">
        <div className="flex items-center justify-between"><h2 className="font-semibold">최근 감사 기록</h2><Link href="/admin/audit" className="text-sm text-accent">전체 보기 →</Link></div>
        <ul className="mt-2 divide-y divide-line text-sm">
          {o.recent.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{ACTION_LABEL[a.action] ?? a.action} · {a.actor}</span><span className="text-xs text-muted">{fmtDate(a.at, true)}</span></li>)}
        </ul>
      </Card>
      <div className="mt-6"><Notice>공급자 실행 설정과 예산은 공급자·스위치 및 사용량·한도에서 관리합니다.</Notice></div>
    </>
  );
}
