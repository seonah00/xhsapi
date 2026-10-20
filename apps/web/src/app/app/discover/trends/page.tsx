import Link from 'next/link';
import { keywordTrackingHistory } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { Card, Empty, PageHeader, btn } from '@/components/ui';
import { fmtDate } from '@/components/labels';
export default async function KeywordTrends() {
  const rows=await withPageCtx(keywordTrackingHistory);
  return <><PageHeader title="키워드 사용 추이" description="같은 검색어로 정기 수집한 게시물에서 정확히 일치하는 해시태그 사용 비율을 비교합니다. 플랫폼 전체 검색량이나 조회수 순위가 아닙니다." actions={<Link href="/app/discover" className={btn.secondary}>탐색으로</Link>}/>
    {!rows.length && <Empty title="아직 추적 중인 키워드가 없습니다">관리자가 공용 키워드를 등록하면 수집 이후부터 이력이 쌓입니다.</Empty>}
    <div className="space-y-4">{rows.map(row=><Card key={row.id}><h2 className="font-semibold"><Link href={`/app/discover?q=${encodeURIComponent(row.term)}`} className="text-accent">#{row.term}</Link></h2><p className="mt-1 text-sm">{row.intervalDays}일 주기 · {row.enabled?'정기 갱신 중':'갱신 중지'} · 최근 1년 집계 {row.snapshots.length}회</p>
      <p className="mt-2 text-sm">{row.comparison.status==='comparable'?`직전 수집 대비 사용 비중 ${row.comparison.changePoints!>=0?'+':''}${row.comparison.changePoints!.toFixed(1)}%p`:row.comparison.status==='method_changed'?'수집 방식이 달라 직접 비교할 수 없습니다.':row.comparison.status==='insufficient'?'변화를 비교하기에는 표본이 부족합니다.':'서로 다른 수집 결과가 2회 이상 쌓이면 비교합니다.'}</p>
      {row.snapshots.length>0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{row.term} 수집 이력</caption><thead><tr><th scope="col">수집 시점</th><th scope="col">태그 사용 / 표본</th><th scope="col">사용 비율</th><th scope="col">작성자 수</th><th scope="col">저장 중앙값</th></tr></thead><tbody>{row.snapshots.map(s=><tr key={s.capturedAt} className="border-t border-line"><td className="py-2">{fmtDate(s.capturedAt,true)}</td><td>{s.evidence.noteCount} / {s.evidence.sampleSize}</td><td>{s.evidence.sampleSize?(100*s.evidence.noteCount/s.evidence.sampleSize).toFixed(1)+'%':'표본 없음'}</td><td>{s.evidence.authorCount}</td><td>{s.evidence.saves.median??'미제공'} ({s.evidence.saves.sampleSize}건)</td></tr>)}</tbody></table></div>}
      <p className="mt-2 text-xs text-muted">각 수집 표본 10건·해당 태그 3건·작성자 2명 이상이며 수집 방식이 같을 때만 비교합니다. 검색 순위와 표본 구성의 영향이 있으며 과거 수치를 소급 생성하지 않습니다.</p>
    </Card>)}</div></>;
}
