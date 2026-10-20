import type { keywordTrend } from '@xhs/core';
export function KeywordTrend({trend}:{trend:ReturnType<typeof keywordTrend>}) {
  const date=(value:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).format(new Date(value));
  return <div className="mt-2 text-xs text-muted">
    <p>수집 표본 내 최근 사용 변화 · 한국 시간 오늘 제외</p>
    <p>최근 7일 게시물 {trend.recent.count}/{trend.recent.total}건 · 이전 7일 {trend.previous.count}/{trend.previous.total}건</p>
    <p>{date(trend.previousStart)} ~ {date(trend.end)} 미만 · {trend.status==='insufficient'?'비교 표본 부족':`사용 비중 ${trend.changePoints!>0?'+':''}${trend.changePoints!.toFixed(1)}%p · ${trend.status==='increase'?'증가':trend.status==='decrease'?'감소':'동일'}`}</p>
    <p>각 기간 표본 10건·해당 태그 3건 이상일 때만 비교합니다. 검색 결과의 게시일 기준이며 플랫폼 전체 유행이나 검색량은 아닙니다.</p>
  </div>;
}
