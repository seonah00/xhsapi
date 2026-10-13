import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { keywordPlanCandidates, listAccounts } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { PageHeader, ErrorNotice, input, btn } from '@/components/ui';
import { PendingButton } from '@/components/pending-button';
import { importKeywords } from './actions';
export default async function KeywordPlanPage({searchParams}:{searchParams:Promise<{source?:string;selected?:string;error?:string}>}) {
  const sp=await searchParams;
  let raw:unknown, selected:string[];
  try {raw=JSON.parse((sp.source??'').slice(0,10000));selected=z.array(z.string().max(40)).min(1).max(8).parse(JSON.parse(sp.selected??'[]'));}
  catch {return <ErrorNotice message="탐색에서 키워드를 1~8개 선택해 다시 가져와 주세요."/>;}
  const data=await withPageCtx(async ctx=>({research:await keywordPlanCandidates(ctx,raw),accounts:await listAccounts(ctx)}));
  const entries=data.research.result.items.filter(e=>selected.includes(e.term));
  if(entries.length!==new Set(selected).size) return <ErrorNotice message="후보가 변경되었습니다. 탐색에서 다시 선택해 주세요."/>;
  return <>
    <PageHeader title="선택 키워드로 기획 시작" description="출처와 뜻을 함께 저장합니다. 아직 경험하지 않은 내용을 사실로 채우지 않습니다."/>
    <ErrorNotice message={sp.error}/>
    <p className="mb-3">{entries.map(e=>`#${e.term}`).join(' ')}</p>
    {!data.accounts.length ? <p>먼저 <Link href="/app/accounts" className="underline">내 계정</Link>을 등록해 주세요.</p> : <form action={importKeywords} className="max-w-2xl space-y-4">
      <input type="hidden" name="source" value={JSON.stringify(data.research.source)}/>
      <input type="hidden" name="requestId" value={randomUUID()}/>
      {selected.map(term=><input key={term} type="hidden" name="selected" value={term}/>)}
      <label className="block">작성 계정<select name="accountId" className={input}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.display_name}</option>)}</select></label>
      <label className="block">기획 이름<input name="name" required maxLength={200} defaultValue={`${data.research.source.query} 기획`.slice(0,200)} className={input}/></label>
      <label className="block">내가 작성할 소재<input name="subject" maxLength={200} defaultValue={data.research.source.query} className={input}/></label>
      <label className="block">직접 확인한 사실 (한 줄에 하나, 선택)<textarea name="facts" maxLength={4000} className={input} placeholder="예: 직접 사용한 제품명과 실제 사용감"/></label>
      <label className="block">촬영 가능한 장면 (한 줄에 하나, 선택)<textarea name="scenes" maxLength={4000} className={input} placeholder="예: 제품 용기와 손등에 바르는 장면"/></label>
      <label className="block">광고·협찬 여부<select name="sponsorship" className={input}><option value="unknown">미확인</option><option value="no">없음</option><option value="yes">있음</option></select></label>
      <p className="text-sm text-muted">저장은 무료이며 AI 호출이 없습니다. 기획실에서 사실과 장면을 완성한 뒤 AI 본문·영상 스크립트 제안을 요청하세요.</p>
      <PendingButton className={btn.primary}>기획실에 저장</PendingButton>
    </form>}
  </>;
}
