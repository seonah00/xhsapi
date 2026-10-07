import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { EnrichmentScope, enrichmentIds } from '@xhs/domain';
import { getNotes, getQuote, requestHash } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { QuoteConfirm } from '@/components/quote-confirm';
import { JobStatus } from '@/components/job-status';
import { PendingButton } from '@/components/pending-button';
import { Card, PageHeader, ErrorNotice, btn } from '@/components/ui';
import { quoteCovers, confirmCovers } from './actions';

export const metadata = { title: '이미지 업데이트' };
export default async function EnrichBatch({ searchParams }: { searchParams: Promise<{ids?:string;quote?:string;job?:string;error?:string}> }) {
  const sp = await searchParams;
  const parsed = EnrichmentScope.safeParse({noteIds:(sp.ids ?? '').split(',')});
  if (!parsed.success) notFound();
  const scope = parsed.data, ids = enrichmentIds(scope);
  const d = await withPageCtx(async ctx => ({
    notes: await getNotes(ctx,ids), mode:ctx.mode,
    quote: sp.quote && z.string().uuid().safeParse(sp.quote).success ? await getQuote(ctx,sp.quote) : null,
  }));
  if (d.notes.length !== ids.length || d.notes.some(n=>n.dataMode!==d.mode)) notFound();
  const back = `/app/notes/enrich?ids=${ids.join(',')}`;
  const matching = d.quote?.operation==='note_enrichment' && d.quote.requestHash===requestHash('note_enrichment',scope);
  return <>
    <PageHeader title="이미지 업데이트" description="선택한 글의 표지 주소와 상세 정보를 한 건씩 조회합니다."/>
    <ErrorNotice message={sp.error}/>
    <Card>
      <p>선택한 게시물 {ids.length}건 · 최대 조회 {ids.length}회</p>
      <p className="mt-2 text-sm text-muted">게시물 검색과 별도로 비용이 발생합니다. 표지 주소가 없거나 만료된 경우 대체 썸네일을 유지합니다.</p>
      {d.mode==='mock' && <p className="mt-2 text-sm text-muted">데모에서는 외부 호출과 자료 변경 없이 승인 흐름만 확인합니다.</p>}
      <details className="mt-3 text-sm"><summary>선택한 게시물 확인</summary><ul className="mt-2 space-y-1">{d.notes.map(n=><li key={n.id} lang="zh-CN">{n.title??'제목 없음'}</li>)}</ul></details>
      {matching && d.quote ? <div className="mt-4"><QuoteConfirm quote={d.quote} title="표지 업데이트 비용 확인" action={confirmCovers} hidden={{ids:ids.join(',')}} cancelHref={back}
        scopeLines={[`대상 ${ids.length}건 · 최대 ${ids.length}회 실행`,'공급자: Apify / Zen Studio','노트 ID만 전송하며 원본 영상을 다운로드하지 않습니다.','응답이 유실되면 자동 재실행하지 않고 확인을 기다립니다.']}/></div>
        : <form action={quoteCovers} className="mt-4"><input type="hidden" name="ids" value={ids.join(',')}/><PendingButton className={btn.primary} pendingText="견적 계산 중…">업데이트 비용 확인</PendingButton></form>}
      {sp.job && z.string().uuid().safeParse(sp.job).success && <div className="mt-4"><JobStatus jobId={sp.job} label="표지 일괄 보완"/></div>}
      <Link href="/app/discover" className={`${btn.secondary} mt-4`}>탐색으로 돌아가기</Link>
    </Card>
  </>;
}
