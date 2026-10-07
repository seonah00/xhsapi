import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getNotes, getQuote, requestHash } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { QuoteConfirm } from '@/components/quote-confirm';
import { JobStatus } from '@/components/job-status';
import { PendingButton } from '@/components/pending-button';
import { PageHeader, ErrorNotice, Card, btn } from '@/components/ui';
import { quoteEnrichment, confirmEnrichment } from './actions';

export const metadata={title:'정보 업데이트'};
export default async function Enrich({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{quote?:string;job?:string;error?:string}>}) {
  const {id}=await params; if(!z.string().uuid().safeParse(id).success) notFound();
  const sp=await searchParams;
  const {note,quote,mode}=await withPageCtx(async ctx=>({note:(await getNotes(ctx,[id]))[0],quote:sp.quote&&z.string().uuid().safeParse(sp.quote).success?await getQuote(ctx,sp.quote):null,mode:ctx.mode}));
  if(!note||note.dataMode!==mode) notFound();
  const back=`/app/notes/${id}/enrich`;
  const matching=quote?.operation==='note_enrichment'&&quote.requestHash===requestHash('note_enrichment',{noteId:id});
  return <>
    <PageHeader title="정보 업데이트" description="선택한 게시물의 이미지와 상세 정보를 최신 상태로 조회합니다." />
    <ErrorNotice message={sp.error}/>
    <Card>
      <h2 className="zh font-semibold" lang="zh-CN">{note.title??'제목 없음'}</h2>
      <p className="mt-2 text-sm text-muted">표지 주소와 본문 발췌·반응 지표를 보완합니다. 이미지 주소가 만료되거나 제공되지 않으면 대체 썸네일을 표시합니다.</p>
      {mode==='mock'&&<p className="mt-2 text-sm text-muted">데모에서는 견적·승인 흐름만 체험하며, 외부 호출이나 저장 자료 변경은 없습니다.</p>}
      {matching&&quote?<div className="mt-4"><QuoteConfirm quote={quote} title="상세 조회 확인" action={confirmEnrichment} hidden={{noteId:id}} cancelHref={back}
        scopeLines={['대상: 선택한 노트 1건','공급자: Apify / Zen Studio','자동 페이지 넘김과 원본 미디어 다운로드는 실행하지 않습니다.','완료 후 보완 정보는 조직 내에서 표시됩니다.']}/></div>
        :<form action={quoteEnrichment} className="mt-4"><input type="hidden" name="noteId" value={id}/><PendingButton className={btn.primary} pendingText="견적 계산 중…">비용 확인</PendingButton></form>}
      {sp.job&&z.string().uuid().safeParse(sp.job).success&&<div className="mt-4"><JobStatus jobId={sp.job} label="정보 업데이트"/></div>}
      <Link href="/app/discover" className={`${btn.secondary} mt-4`}>탐색 결과로 돌아가기</Link>
    </Card>
  </>;
}
