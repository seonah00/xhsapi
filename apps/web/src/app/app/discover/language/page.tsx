import { KeywordRecommendations } from '@/components/keyword-recommendations';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getQuote, keywordPlanCandidates, languageQuoteDetails, languageJobResult } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { JobStatus } from '@/components/job-status';
import { CopyButton } from '@/components/copy-button';
import { PendingButton } from '@/components/pending-button';
import { btn, input, PageHeader, ErrorNotice } from '@/components/ui';
import { confirmLanguage, previewLanguage } from './actions';
import { searchAutomatically } from '../actions';
export default async function LanguagePage({searchParams}:{searchParams:Promise<{quote?:string;job?:string;error?:string}>}) {
  const sp=await searchParams;
  const data=await withPageCtx(async ctx=>({admin:ctx.role==='org_admin',details:sp.quote&&z.string().uuid().safeParse(sp.quote).success?await languageQuoteDetails(ctx,sp.quote):null,quote:sp.quote&&z.string().uuid().safeParse(sp.quote).success?await getQuote(ctx,sp.quote):null,job:sp.job&&z.string().uuid().safeParse(sp.job).success?await languageJobResult(ctx,sp.job):null}));
  const quote=data.quote?.operation==='query_expansion'?data.quote:null;
  const result=data.job?.state==='succeeded'?data.job.result_ref:null;
  const expanded=result && data.job?.input_ref.task==='expand' && sp.job ? await withPageCtx(ctx=>keywordPlanCandidates(ctx,{query:data.job!.input_ref.task==='expand'?data.job!.input_ref.query:'',noteIds:[],jobId:sp.job})) : null;
  return <>
    <PageHeader title="중국어 검색·표현 AI" description="한국어 검색 의도를 중국어로 옮기고, 실제 수집 문맥에서 표현을 해석합니다."/>
    <Link href="/app/discover" className={btn.secondary}>탐색으로 돌아가기</Link>
    <ErrorNotice message={sp.error}/>
    <form action={previewLanguage} className="my-4 space-y-2 rounded-xl border border-line p-4">
      <input type="hidden" name="task" value="translate"/>
      <label htmlFor="language-query" className="block font-medium">한국어로 찾고 싶은 내용</label>
      <textarea id="language-query" name="query" required maxLength={1000} className={input} placeholder="예: 서울에서 비 오는 날 아이와 실내에서 놀 수 있는 곳"/>
      <PendingButton className={btn.primary}>AI 중국어 검색어 만들기</PendingButton>
    </form>
    <form action={previewLanguage} className="my-4 space-y-2 rounded-xl border border-line p-4">
      <input type="hidden" name="task" value="expand"/>
      <label htmlFor="expand-query" className="block font-medium">연관·롱테일 키워드를 찾을 주제</label>
      <textarea id="expand-query" name="query" required maxLength={200} className={input} placeholder="예: 집에서 만드는 저당 도시락, 비 오는 날 서울 실내 데이트"/>
      <PendingButton className={btn.primary}>AI 키워드 확장 준비</PendingButton>
      <p className="text-xs text-muted">사전에 맞는 항목을 함께 참고합니다. 실제 검색 자료가 없는 추천은 미검증 후보로 표시합니다.</p>
    </form>
    {quote && <section className="my-4 rounded-xl border border-line p-4">
      <h2 className="font-semibold">AI 처리 확인</h2>
      <p>{data.details?.task==='expand'?`확장할 검색 주제: ${data.details.query}`:data.details?.task==='translate'?`번역할 검색 문장: ${data.details.query}`:`해석 대상: 게시물 ${data.details?.sampleSize??0}개의 제목·본문 발췌·태그`}</p>
      <p>검색 문장, 관련 공개 사전의 뜻, 선택한 게시물의 제목·본문 일부·태그를 OpenAI에 전달합니다. 이미지·영상은 보내지 않습니다. AI 해석은 틀릴 수 있습니다.</p>
      {data.admin && <p>최대 {quote.maxAmount} {quote.currency} · 월 {quote.usedThisMonth}/{quote.monthlyLimit}회</p>}
      {quote.mode==='mock'&&<p>데모 모드: 실제 AI 호출 없이 고정 예시를 표시합니다.</p>}
      {quote.expired||quote.consumed?<p>요청이 만료되었거나 이미 실행됐습니다.</p>:<form action={confirmLanguage} className="mt-3 space-y-2">
        <input type="hidden" name="quoteId" value={quote.id}/><input type="hidden" name="idem" value={randomUUID()}/>
        <label className="block"><input type="checkbox" name="consent" required/> 외부 AI 처리에 동의합니다. 조직의 AI 이용 한도가 적용됩니다.</label>
        <PendingButton className={btn.primary}>AI 실행</PendingButton>
      </form>}
    </section>}
    {sp.job && data.job && <JobStatus jobId={sp.job} label="검색·표현 AI"/>}
    {data.job?.state==='unknown_outcome'&&<p className="text-warn">처리 결과를 확인할 수 없습니다. 중복 과금을 막기 위해 다시 실행하지 말고 관리자에게 확인하세요.</p>}
    {result && <section className="mt-4 space-y-3">
      {result.demo&&<p className="text-warn">고정 데모 예시이며 실제 번역·분석 결과가 아닙니다.</p>}
      {expanded && <KeywordRecommendations result={expanded.result} source={expanded.source}/>}
      {result.output.translations.map(t=><article key={t.zh} className="rounded-xl border border-line p-3"><h2 lang="zh-CN" className="font-semibold">{t.zh}</h2><p>{t.meaningKo}</p><CopyButton text={t.zh} label="검색어 복사"/><form action={searchAutomatically} className="mt-2"><input type="hidden" name="q" value={t.zh}/><PendingButton className={btn.primary}>이 중국어로 게시물 검색</PendingButton></form></article>)}
      {data.job?.input_ref.task==='interpret'&&<><h2 className="font-semibold">문맥에서 발견한 표현 해석</h2><p className="text-sm text-muted">입력 길이 한도 내 {result.input.notes.length}개 게시물의 발췌문 기준입니다. 전체 인기나 유행 여부를 뜻하지 않습니다. 원문에서 근거를 확인할 수 없는 후보는 제외합니다.</p>{!result.output.expressions.length&&<p>이 표본에서 해석할 표현을 확인하지 못했습니다.</p>}</>}
      {result.output.expressions.map(e=>{
        const count=result.input.notes.filter(n=>[n.title,n.body,...n.tags].some(t=>t.includes(e.term))).length;
        return <article key={e.term} className="rounded-xl border border-line p-3"><h3 lang="zh-CN" className="font-semibold">{e.term}</h3><p>표본 {result.input.notes.length}개 중 {count}개에서 발견 · AI 확신도 {({low:'낮음',medium:'보통',high:'높음'})[e.confidence]}</p><p>{e.meaningKo}</p><p>{e.usageKo}</p><p className="text-warn">{e.cautionKo}</p><CopyButton text={e.term} label="표현 복사"/><ul>{e.evidence.map((r,i)=><li key={i}><Link className="underline" href={`/app/notes/${result.noteIds[result.input.notes.findIndex(n=>n.alias===r.alias)]}`}>근거 게시물</Link><blockquote lang="zh-CN">{r.quote}</blockquote></li>)}</ul></article>;
      })}
    </section>}
  </>;
}
