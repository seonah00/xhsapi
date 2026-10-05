import Link from 'next/link';
import { listAudit } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { btn, Empty, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { ACTION_LABEL, ROLE_LABEL } from '../labels';

export const metadata = { title: '감사 기록' };

function describe(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.role === 'string') parts.push(`역할 ${ROLE_LABEL[meta.role] ?? meta.role}`);
  if (typeof meta.status === 'string') parts.push(`상태 ${meta.status}`);
  if (typeof meta.name === 'string') parts.push(`이름 ${meta.name}`);
  if (meta.used === true) parts.push('사용됨');
  if (meta.revoked === true) parts.push('취소됨');
  return parts.join(' · ');
}

export default async function Audit({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const { items, nextBefore } = await withAdmin((ctx) => listAudit(ctx, before ? { before: Number(before) } : {}));
  return (
    <>
      <PageHeader title="감사 기록" description="멤버·초대·기수 변경 기록입니다. 토큰이나 학생 문안은 기록하지 않습니다." />
      {items.length === 0 ? <Empty title="기록이 없습니다" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="p-3 font-normal">시각</th><th scope="col" className="p-3 font-normal">작업</th><th scope="col" className="p-3 font-normal">수행자</th><th scope="col" className="p-3 font-normal">내용</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap p-3 text-muted">{fmtDate(a.at, true)}</td>
                  <td className="p-3">{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td className="p-3">{a.actor}</td>
                  <td className="p-3 text-muted">{describe(a.meta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextBefore && <div className="mt-4 text-center"><Link href={`/admin/audit?before=${nextBefore}`} className={btn.secondary}>이전 기록</Link></div>}
    </>
  );
}
