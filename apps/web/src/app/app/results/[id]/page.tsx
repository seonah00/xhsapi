import Link from 'next/link';
import { listPublications, METRIC_KEYS } from '@xhs/core';
import { notFound } from 'next/navigation';
import { safeExternalHref } from '@xhs/security';
import { withPageCtx } from '@/server/ctx';
import { addResult, removePublication } from '../actions';
import { Badge, btn, Card, ErrorNotice, input, Notice, PageHeader } from '@/components/ui';
import { fmtDate, formatLabel, topicLabel } from '@/components/labels';

export const metadata = { title: '게시물 성과' };
const LABEL: Record<string, string> = { views: '조회', likes: '좋아요', saves: '저장', comments: '댓글', shares: '공유', follows_attributed: '이 게시물로 늘어난 팔로우', search_traffic: '검색 유입', impressions: '노출' };
const nf = new Intl.NumberFormat('ko-KR');

export default async function PublicationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; added?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = (await withPageCtx((ctx) => listPublications(ctx))).find((x) => x.id === id);
  if (!p) notFound();
  const href = p.noteUrl ? safeExternalHref(p.noteUrl) : null;
  return (
    <>
      <PageHeader title={p.title ?? '게시물'} description={<>{p.accountName} · 발행 {fmtDate(p.publishedAt, true)}</>} actions={<Link href={`/app/results?account=${p.accountId}`} className={btn.secondary}>목록</Link>} />
      <ErrorNotice message={sp.error} />
      {sp.added && <div className="mb-3"><Notice tone="ok">새 관찰값을 기록했습니다. 이전 기록은 그대로 남습니다.</Notice></div>}
      <div className="mb-4 flex flex-wrap gap-1 text-sm">
        {p.topic && <Badge>{topicLabel(p.topic)}</Badge>}{p.format && <Badge tone="info">{formatLabel(p.format)}</Badge>}
        {p.paidPromotion === 'yes' && <Badge tone="warn">유료 프로모션</Badge>}{p.sponsorship === 'yes' && <Badge tone="warn">협찬</Badge>}
        {p.planId && <Link href={`/app/plans/${p.planId}`} className="text-accent underline">연결된 기획</Link>}
        {href && <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">게시물 열기 ↗</a>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <h2 className="font-semibold">관찰 기록</h2>
          {p.snapshots.length === 0 ? <p className="mt-2 text-sm text-muted">아직 기록이 없습니다.</p> : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 font-normal">관찰 시각</th>{METRIC_KEYS.map((k) => <th key={k} scope="col" className="font-normal">{LABEL[k]}</th>)}<th scope="col" className="font-normal">출처</th></tr></thead>
                <tbody>{p.snapshots.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="py-2">{fmtDate(s.observedAt, true)}</td>
                    {METRIC_KEYS.map((k) => <td key={k} className={typeof s.metrics[k] === 'number' ? 'tabular-nums' : 'text-muted'}>{typeof s.metrics[k] === 'number' ? nf.format(s.metrics[k]!) : '미확인'}</td>)}
                    <td className="text-xs text-muted">{s.source === 'manual' ? '직접 입력' : '분석 화면 내보내기'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">새 관찰값 입력</h2>
          <form action={addResult} className="mt-3 space-y-2 text-sm">
            <input type="hidden" name="publicationId" value={p.id} />
            <label className="block">관찰 시각<input name="observedAt" type="datetime-local" required className={`${input} mt-1`} /></label>
            <div className="grid grid-cols-2 gap-2">
              {METRIC_KEYS.map((k) => <label key={k} className="block">{LABEL[k]}<input name={k} type="number" min={0} step={1} inputMode="numeric" placeholder="모르면 비움" className={`${input} mt-1`} /></label>)}
            </div>
            <label className="block">값의 출처<select name="source" className={`${input} mt-1`}><option value="manual">직접 입력</option><option value="user_analytics_export">샤오홍슈 분석 화면에서 옮김</option></select></label>
            <p className="text-xs text-muted">팔로워 전체 증가가 아니라 이 게시물로 늘어난 팔로우만 입력하세요.</p>
            <button className={btn.primary}>기록</button>
          </form>
          <form action={removePublication} className="mt-4"><input type="hidden" name="publicationId" value={p.id} /><button className={btn.ghost}>이 발행 기록 삭제</button></form>
        </Card>
      </div>
    </>
  );
}
