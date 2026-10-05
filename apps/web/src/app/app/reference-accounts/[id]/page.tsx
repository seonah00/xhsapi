import { notFound } from 'next/navigation';
import { getReferenceAccount } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { formatMetric } from '@/components/metric';
import { NoteCard } from '@/components/note-card';
import { Badge, btn, Card, ErrorNotice, LinkButton, Notice, PageHeader } from '@/components/ui';
import { fmtDate, formatLabel, topicLabel } from '@/components/labels';
import { removeAccount } from '../actions';

export const metadata = { title: '참고 계정' };

export default async function ReferenceAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withPageCtx((ctx) => getReferenceAccount(ctx, id));
  const bar = (counts: Record<string, number>, fmt: (s: string) => string) => {
    const max = Math.max(1, ...Object.values(counts));
    return Object.keys(counts).length === 0 ? <p className="text-sm text-muted">분류된 자료가 없습니다.</p> : (
      <ul className="space-y-1 text-sm">{Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
        <li key={k} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2"><span className="truncate">{fmt(k)}</span>
          <span className="h-2 rounded bg-accent/70" style={{ width: `${(n / max) * 100}%` }} aria-hidden /><span className="text-right tabular-nums">{n}</span></li>
      ))}</ul>
    );
  };
  return (
    <>
      <PageHeader title={d.account.displayName} description={<>참고 계정 · {fmtDate(d.account.observedAt, true)} 관찰 {d.account.dataMode === 'mock' && <Badge tone="warn">데모</Badge>}</>}
        actions={<LinkButton href="/app/reference-accounts">목록</LinkButton>} />
      <ErrorNotice message={error} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-muted">팔로워(저장 시점)</p><p className="text-lg font-semibold">{formatMetric(d.account.snapshot.followers).text}</p></Card>
        <Card><h2 className="mb-2 text-sm font-semibold">주제 분포</h2>{bar(d.topicCounts, topicLabel)}</Card>
        <Card><h2 className="mb-2 text-sm font-semibold">형식 분포</h2>{bar(d.formatCounts, formatLabel)}</Card>
      </div>
      <Notice tone="info">이 계정의 저장된 글 {d.notes.length}건만 기준입니다. 전체 게시물·성장 추이가 아니며, 그대로 따라 하기보다 내 계정 방향과 맞는 부분만 참고하세요.</Notice>
      <h2 className="mb-2 mt-6 font-semibold">저장된 글</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {d.notes.map((n) => <NoteCard key={n.id} note={n} back={`/app/reference-accounts/${id}`} inCompare={false} />)}
      </div>
      <form action={removeAccount} className="mt-8"><input type="hidden" name="id" value={id} /><button className={btn.ghost}>참고 계정에서 삭제</button></form>
    </>
  );
}
