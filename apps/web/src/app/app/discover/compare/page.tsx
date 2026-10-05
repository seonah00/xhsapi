import { getNotes } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { clearCompare, getCompareIds, toggleCompare } from '../actions';
import { Badge, btn, DemoBadge, Empty, LinkButton, Notice, PageHeader } from '@/components/ui';
import { formatMetric } from '@/components/metric';
import { fmtDate, formatLabel, topicLabel } from '@/components/labels';

export const metadata = { title: '비교' };

export default async function Compare() {
  const ids = await getCompareIds();
  const notes = await withPageCtx((ctx) => getNotes(ctx, ids));
  const observed = new Set(notes.map((n) => n.observedAt?.slice(0, 10)));
  const rows: [string, (n: (typeof notes)[number]) => React.ReactNode][] = [
    ['제목', (n) => <span className="zh" lang="zh-CN">{n.title}</span>],
    ['주제', (n) => n.topics.map(topicLabel).join(', ') || '미분류'],
    ['형식', (n) => n.formats.map(formatLabel).join(', ') || '미분류'],
    ['게시일', (n) => fmtDate(n.publishedAt)],
    ['좋아요', (n) => formatMetric(n.metrics.likes).text],
    ['저장', (n) => formatMetric(n.metrics.saves).text],
    ['댓글', (n) => formatMetric(n.metrics.comments).text],
    ['작성자 팔로워', (n) => formatMetric(n.authorFollowers).text],
    ['관찰 시점', (n) => fmtDate(n.observedAt, true)],
    ['분석 범위', () => '메타데이터만'],
  ];
  return (
    <>
      <PageHeader title="레퍼런스 비교" description="저장된 데이터만 나란히 봅니다. 비교는 AI나 외부 조회를 실행하지 않습니다."
        actions={<><LinkButton href="/app/discover">탐색으로</LinkButton>{notes.length > 0 && <form action={clearCompare}><button className={btn.secondary}>비우기</button></form>}</>} />
      {notes.length === 0 ? <Empty title="비교할 노트가 없습니다">탐색에서 최대 3개까지 추가하세요.</Empty> : (
        <>
          {observed.size > 1 && <div className="mb-3"><Notice tone="warn">관찰 시점이 서로 다릅니다. 반응 수를 직접 비교할 때 주의하세요.</Notice></div>}
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-line">
                <th scope="col" className="p-3 text-left text-muted">항목</th>
                {notes.map((n) => <th key={n.id} scope="col" className="p-3 text-left"><DemoBadge mode={n.dataMode} /></th>)}
              </tr></thead>
              <tbody>
                {rows.map(([label, cell]) => (
                  <tr key={label} className="border-b border-line last:border-0">
                    <th scope="row" className="p-3 text-left font-normal text-muted">{label}</th>
                    {notes.map((n) => <td key={n.id} className="p-3 align-top">{cell(n)}</td>)}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="p-3" />
                  {notes.map((n) => (
                    <td key={n.id} className="p-3">
                      <form action={toggleCompare}><input type="hidden" name="noteId" value={n.id} /><input type="hidden" name="back" value="/app/discover/compare" /><button className={btn.small}>빼기</button></form>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted"><Badge>조회수</Badge> 공급 자료에 없어 비교하지 않습니다. 저장률도 계산하지 않습니다.</p>
        </>
      )}
    </>
  );
}
