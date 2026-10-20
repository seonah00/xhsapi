'use client';
import { SavePersonal } from './save-personal';
import { useState } from 'react';
import Link from 'next/link';
import type { recommendKeywords, KeywordRecommendation } from '@xhs/core';
import { previewLanguage } from '@/app/app/discover/language/actions';
import type { KeywordPlanSource } from '@xhs/core';
import type { z } from 'zod';
import { searchAutomatically } from '@/app/app/discover/actions';
import { PendingButton } from './pending-button';
import { CopyButton } from './copy-button';
import { fmtDate } from './labels';
import { KeywordTrend } from './keyword-trend';
import { verifyCandidates } from '@/app/app/discover/verify/actions';

type Order='saves'|'likes'|'usage';
const number=(n:number)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n);

export function KeywordRecommendations({ result, source }: { result: ReturnType<typeof recommendKeywords>; source: z.infer<typeof KeywordPlanSource> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [audience, setAudience] = useState('');
  const [situation, setSituation] = useState('');
  const [order,setOrder]=useState<Order>('saves');
  const custom = `${audience.trim()}${situation.trim()}${result.zh}`;
  const observed=result.items.filter(item=>item.noteCount>0).sort((a,b)=>{
    if(order==='usage') return b.noteCount-a.noteCount || a.term.localeCompare(b.term,'zh-CN');
    const enough=Number(b.performance?.strength==='comparable')-Number(a.performance?.strength==='comparable');
    return enough || (b.performance?.[order].median??-1)-(a.performance?.[order].median??-1) || b.noteCount-a.noteCount || a.term.localeCompare(b.term,'zh-CN');
  });
  const candidates=result.items.filter(item=>item.noteCount===0).sort((a,b)=>Number(!!b.aiReason)-Number(!!a.aiReason));
  const searched=result.items.find(item=>item.term===result.zh);
  const selectedVerified=selected.filter(term=>observed.some(item=>item.term===term));
  function card(item:KeywordRecommendation,verified:boolean) {
    const p=item.performance;
    return <li key={item.term} className="rounded-xl border border-line p-3">
      <label className="flex gap-2"><input type="checkbox" disabled={!verified || (!selectedVerified.includes(item.term) && (selectedVerified.length >= 8 || item.term.length > 40))} checked={selectedVerified.includes(item.term)} onChange={e=>setSelected(current=>e.target.checked?[...current.filter(t=>observed.some(item=>item.term===t)),item.term]:current.filter(t=>t!==item.term))}/><span lang="zh-CN">#{item.term}</span></label>
      <p className="text-xs text-muted">{{core:'핵심',related:'연관',longTail:'롱테일'}[item.group]} · {item.dictionaryIds.length?'공용사전 수록 · ':''}{verified?`실사용 확인 · 현재 표본 ${item.noteCount}/${result.sampleSize}건`:'실사용 미확인 · 검색 후보'}</p>
      {p && verified && <div className="my-2 space-y-1 text-sm" aria-label={`${item.term} 사용 게시물 반응`}>
        <p>확인된 작성자 {p.authorCount}명 · {p.strength==='comparable'?'비교 표본 충분':'표본 부족 — 반응 순위 해석에 주의하세요'}</p>
        <p>저장 중앙값 {p.saves.median===null?'미제공':number(p.saves.median)} · 정확한 수치 {p.saves.sampleSize}/{p.noteCount}건</p>
        <p>좋아요 중앙값 {p.likes.median===null?'미제공':number(p.likes.median)} · 정확한 수치 {p.likes.sampleSize}/{p.noteCount}건</p>
        <p>댓글 중앙값 {p.comments.median===null?'미제공':number(p.comments.median)} · 정확한 수치 {p.comments.sampleSize}/{p.noteCount}건</p>
        <p>{p.views.median===null?'조회수 미제공':`게시물 조회수 중앙값 ${number(p.views.median)} · 정확한 수치 ${p.views.sampleSize}/${p.noteCount}건`}</p>
        <p className="text-xs text-muted">확인 {fmtDate(p.observedFrom)} ~ {fmtDate(p.observedTo)} · 게시 {fmtDate(p.publishedFrom)} ~ {fmtDate(p.publishedTo)}</p>
      </div>}
      {verified && item.trend && <KeywordTrend trend={item.trend}/>}
      {item.meaning && <p className="text-sm">{item.meaning}</p>}
      {item.aiReason && <p className="text-xs text-muted">AI 제안 이유: {item.aiReason}</p>}
      {item.cautions.map((c,i)=><p key={i} className="text-xs text-warn">{c}</p>)}
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <form action={searchAutomatically}><input type="hidden" name="q" value={item.term}/><PendingButton className="underline">{verified?'이 태그로 추가 검색':'실제 게시물로 검증'}</PendingButton></form>
        {!!item.dictionaryIds.length && <Link href={`/app/dictionary?q=${encodeURIComponent(item.term)}`} className="underline">사전에서 활용하기</Link>}
        {item.evidence.map((e,i)=><Link key={e.noteId} href={`/app/notes/${e.noteId}`} className="underline">근거 게시물 {i+1}</Link>)}
      </div>
      {verified && <SavePersonal source={{kind:"observed",source,term:item.term}}/>}
    </li>;
  }
  return <div className="mb-6 border-b border-line pb-5">
    <h2 className="font-semibold">사전과 검색 결과로 키워드 정리</h2>
    <p className="mt-1 text-sm text-muted">현재 검색 표본 최대 50건에서 실제로 발견한 태그를 비교합니다. 공용사전은 뜻과 주의사항을 보완하며 과거 관찰 수는 현재 사용 횟수에 합산하지 않습니다.</p>
    <p className="mt-1 text-xs text-muted">게시물 반응은 키워드 검색량·전체 조회수·태그의 성과 효과를 뜻하지 않습니다. 검색 순서와 수집 범위에 영향을 받습니다. 새 검색이 진행 중이면 완료 후 표본이 갱신됩니다.</p>
    <section className="mt-4" aria-label="실사용 검증 결과">
      <h3 className="font-medium">실사용이 확인된 태그 · 게시물 반응 비교</h3>
      {result.zh && <p className="my-2 text-sm">검색어와 같은 태그 #{result.zh}: {searched?.noteCount?`표본 ${searched.noteCount}/${result.sampleSize}건에서 확인`:'현재 표본에서 확인되지 않았습니다. 이 검색어 자체가 사용되지 않는다는 뜻은 아닙니다.'}</p>}
      <label className="text-sm">반응 비교 정렬 <select value={order} onChange={e=>setOrder(e.target.value as Order)} className="rounded border border-line p-2"><option value="saves">비교 표본 충분 · 저장 중앙값 순</option><option value="likes">비교 표본 충분 · 좋아요 중앙값 순</option><option value="usage">태그 사용 게시물 수 순</option></select></label>
      <p className="mt-1 text-xs text-muted">비교 표본 충분: 게시물 3건 이상·확인된 작성자 2명 이상·정확한 저장 수 3건 이상. 미제공·반올림 수치는 중앙값 계산에서 제외합니다.</p>
      {!observed.length && <p className="my-3 text-sm">현재 표본에서 확인된 태그가 없습니다. 아래 후보를 실제 게시물로 검증해 주세요.</p>}
      <ul className="mt-2 grid gap-2 md:grid-cols-2">{observed.map(item=>card(item,true))}</ul>
    </section>
    <details className="mt-5 rounded-xl border border-line p-3">
      <summary className="cursor-pointer font-medium">검증 전 검색 후보 {candidates.length}개 · AI·사전·대상 조합</summary>
      <p className="my-2 text-sm">후보는 실사용 추천에 포함되지 않습니다. 실제 게시물로 검증을 누르면 기존 검색 한도 안에서 조회하고, 검색 화면에 태그 사용 근거와 반응을 표시합니다. 최근 검색은 재사용할 수 있습니다.</p>
      {!!candidates.length && <form action={verifyCandidates} className="my-3 rounded border border-line p-3">
        <input type="hidden" name="source" value={JSON.stringify(source)}/>
        {candidates.slice(0,3).map(item=><input key={item.term} type="hidden" name="term" value={item.term}/>)}
        <p>검증 대상: {candidates.slice(0,3).map(item=>`#${item.term}`).join(' · ')}</p>
        <PendingButton className="mt-2 rounded border border-line px-3 py-2">후보 {Math.min(3,candidates.length)}개 자동 검증</PendingButton>
        <p className="text-xs text-muted">한 번 누르면 후보별 검색과 실사용 확인을 진행합니다. 기존 검색 한도와 최근 결과 재사용이 적용됩니다.</p>
      </form>}
      {(['core','related','longTail'] as const).map(group=><section key={group} className="mt-4">
        <h3 className="font-medium">{{core:'핵심 키워드',related:'연관 키워드',longTail:'롱테일 키워드 · 대상과 상황을 구체화'}[group]}</h3>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">{candidates.filter(item=>item.group===group).map(item=>card(item,false))}</ul>
      </section>)}
      {!source.jobId && <form action={previewLanguage} className="my-3">
        <input type="hidden" name="task" value="expand"/><input type="hidden" name="query" value={source.query}/><input type="hidden" name="noteIds" value={source.noteIds.join(',')}/>
        <PendingButton className="rounded-lg border border-line px-3 py-2">AI로 연관·롱테일 키워드 확장</PendingButton>
        <p className="text-xs text-muted">선택한 주제·사전 설명·게시물 발췌로 검색 후보를 만듭니다. AI 후보 생성 후에도 실사용 검증이 필요합니다. 실행 전에 외부 AI 처리 동의를 받습니다.</p>
      </form>}
    </details>
    <div className="mt-4 space-y-2">
      <p className="text-sm">중국어 대상·상황을 붙여 롱테일 검색 후보를 만들 수 있습니다.</p>
      <label className="block text-sm">대상 (예: 敏感肌)<input className="ml-2 rounded border border-line p-2" value={audience} maxLength={20} onChange={e=>setAudience(e.target.value)}/></label>
      <label className="block text-sm">상황 (예: 夏季)<input className="ml-2 rounded border border-line p-2" value={situation} maxLength={20} onChange={e=>setSituation(e.target.value)}/></label>
      {(audience || situation) && <form action={searchAutomatically}><input type="hidden" name="q" value={custom}/><p lang="zh-CN">{custom} · 실사용 미확인</p><PendingButton disabled={!result.zh || custom.length>50 || /[가-힣]/.test(custom)} className="underline">조합한 키워드로 게시물 찾기</PendingButton></form>}
      {!!selectedVerified.length && <CopyButton text={selectedVerified.map(t=>`#${t}`).join(' ')} label={`선택한 ${selectedVerified.length}개 태그 복사`}/>}
      <p className="text-xs text-muted">태그 선택·복사는 현재 표본에서 실사용이 확인된 항목만 가능합니다.</p>
    </div>
  </div>;
}
