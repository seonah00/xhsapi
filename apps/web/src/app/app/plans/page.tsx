import Link from 'next/link';
import { listPlans } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { Badge, Empty, LinkButton, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { PLAN_STATUS } from '@/components/plan-labels';

export const metadata = { title: '기획실' };

export default async function Plans() {
  const plans = await withPageCtx((ctx) => listPlans(ctx));
  return (
    <>
      <PageHeader title="기획실" description="내 사실과 촬영 가능한 장면으로 기획합니다. 레퍼런스는 참고만 하고 그대로 복제하지 않습니다."
        actions={<LinkButton href="/app/plans/new" variant="primary">+ 새 기획</LinkButton>} />
      {plans.length === 0 ? <Empty title="아직 기획이 없습니다">새 소재, 저장한 레퍼런스, 키워드·표현 중 하나에서 시작하세요.</Empty> : (
        <ul className="space-y-2">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`/app/plans/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-accent">
                <div><p className="font-medium">{p.title}</p><p className="text-xs text-muted">{p.accountName} · 버전 {p.currentVersion ?? '-'} · {fmtDate(p.updatedAt, true)} 수정</p></div>
                <Badge tone="info">{PLAN_STATUS[p.status] ?? p.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
