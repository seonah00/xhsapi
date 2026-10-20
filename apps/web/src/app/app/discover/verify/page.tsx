import Link from 'next/link';
import { keywordVerificationResults } from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { AutoSearchStatus } from '@/components/auto-search-status';
import { KeywordTrend } from '@/components/keyword-trend';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/ui';
export default async function VerificationPage({searchParams}:{searchParams:Promise<{ids?:string}>}) {
  const {ids}=await searchParams;
  const results=await withPageCtx(ctx=>keywordVerificationResults(ctx,service,(ids??'').split(',')));
  return <>
    <PageHeader title="후보 자동 검증" description="후보별 실제 게시물을 수집하고 같은 해시태그가 있는지 확인합니다. 결과가 없으면 실사용 미확인으로 남습니다."/>
    <Link href="/app/discover" className="underline">탐색으로 돌아가기</Link>
    <p className="my-3 text-sm">최대 3개 후보를 검색 한도 안에서 처리합니다. 최근 결과는 재사용하며 결과 불명 작업은 자동 재실행하지 않습니다. 페이지를 닫아도 접수된 검색은 계속됩니다.</p>
    {results.map(r=><section key={r.requestId} className="my-4 rounded-xl border border-line p-4">
      <h2 lang="zh-CN" className="font-semibold">#{r.term}</h2>
      {['queued','running','waiting_external'].includes(r.state)?<AutoSearchStatus requestId={r.requestId}/>:r.state==='succeeded'?<>
        <p>{r.evidence.noteCount?`실사용 확인 · ${r.evidence.noteCount}/${r.evidence.sampleSize}건 · 작성자 ${r.evidence.authorCount}명`:'실사용 미확인 · 검색 결과에 정확히 같은 해시태그가 없습니다.'}</p>
        <p>저장 중앙값 {r.evidence.saves.median??'미제공'} · 정확한 수치 {r.evidence.saves.sampleSize}건</p>
        {!!r.evidence.noteCount && <CopyButton text={`#${r.term}`} label="확인된 태그 복사"/>}
        <KeywordTrend trend={r.trend}/>
        <Link className="underline" href={`/app/discover?q=${encodeURIComponent(r.term)}&auto=${r.requestId}`}>게시물과 근거 확인</Link>
      </>:<p>{r.state==='unknown_outcome'?'처리 결과 확인 필요 · 중복 실행하지 말고 관리자에게 확인하세요.':'검증을 완료하지 못했습니다. 실사용 여부를 확인하지 못했습니다.'}</p>}
    </section>)}
  </>;
}
