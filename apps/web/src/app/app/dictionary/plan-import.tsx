'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DictionaryAiInput, DictionaryAiResult, SharedDictionaryEntry } from '@xhs/core';
import { btn, input } from '@/components/ui';
import { dictionaryPlanAction } from './actions';
import { expressionGuide, appendPractice } from './expression-guides';

export type PlanAccount = { id: string; name: string };
export function DictionaryPlanImport({ entries, source, result, accounts }: {
  entries: SharedDictionaryEntry[]; source: DictionaryAiInput;
  result?: DictionaryAiResult | undefined; accounts: PlanAccount[];
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(dictionaryPlanAction, {});
  const [title, setTitle] = useState(result?.titles[0]?.zh ?? '');
  const [cover, setCover] = useState('');
  const [body, setBody] = useState(result?.bodyZh ?? '');
  const [practice, setPractice] = useState('');
  const [applied, setApplied] = useState('');
  const payload = JSON.stringify({
    reviewNotes: result ? [...result.blockers, ...result.warnings] : [],
    requestId, entryIds: entries.map(e => e.id), notes: source.notes,
    mode: source.mode, disclosure: source.disclosure,
    content: {
      body, meaningKo: result?.bodyKo ?? '',
      tags: result?.tags ?? entries.filter(e => e.entryType === 'tag').map(e => e.term),
    },
  });
  if (state.planId) return <section className="mt-4 rounded-xl border border-line p-3" aria-label="기획실 가져오기">
    <p role="status">비공개 기획으로 저장했습니다.</p>
    <Link className={`${btn.primary} mt-2`} href={`/app/plans/${state.planId}`}>저장한 기획 열기</Link>
  </section>;
  return <section className="mt-4 space-y-3 rounded-xl border border-line p-3" aria-label="기획실 가져오기">
    <h3 className="font-semibold">기획실로 가져오기</h3>
    <p className="text-xs text-muted">선택한 사전 항목과 {result ? '생성 결과' : '내 메모'}를 내 비공개 기획으로 저장합니다. 추가 AI 호출 없이 제목·표지 문구·촬영 목록을 이어서 편집할 수 있습니다.</p>
    {entries.some(e => e.entryType === 'expression') && <section aria-label="표현 활용 가이드" className="space-y-3 rounded-lg bg-bg p-3">
      <h4 className="font-semibold">표현 활용 가이드</h4>
      <p className="text-xs text-muted">예문은 학습용 편집 문장입니다. 실제 게시물 인용이나 내 경험이 아닙니다. 뜻과 사실관계를 확인한 뒤 내 소재에 맞게 고쳐 쓰세요.</p>
      {entries.filter(e => e.entryType === 'expression').map(e => {
        const guide = expressionGuide(e.term);
        return <details key={e.id} className="rounded-lg border border-line p-2">
          <summary className="cursor-pointer font-medium">{e.term} 활용 보기</summary>
          <p className="mt-2 text-sm">사전 뜻: {e.meaning}</p>
          {e.cautions.length > 0 && <p className="mt-1 text-xs text-warn">사전 주의사항: {e.cautions.join(' · ')}</p>}
          {guide ? <div className="mt-2 space-y-2 text-sm">
            <p><strong>사용 상황</strong> · {guide.situation}</p>
            <p><strong>뉘앙스</strong> · {guide.nuance}</p>
            <p><strong>피할 사용</strong> · {guide.avoid}</p>
            <p lang="zh-CN" className="zh">{guide.zh}</p><p className="text-xs text-muted">{guide.ko}</p>
            <button type="button" className={btn.secondary} onClick={() => { setPractice(guide.zh); setApplied('예문을 연습칸에 넣었습니다. 내 소재에 맞게 수정하세요.'); }}>이 예문으로 연습</button>
          </div> : <p className="mt-2 text-xs text-muted">이 표현의 편집 예문은 아직 준비되지 않았습니다. 위 뜻과 주의사항을 참고해 직접 문장을 작성하세요.</p>}
        </details>;
      })}
      <label className="block text-sm">내 소재로 바꾼 문장<textarea aria-label="내 소재로 바꾼 문장" value={practice} onChange={e => { setPractice(e.target.value); setApplied(''); }} rows={3} maxLength={500} className={`${input} zh`} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!practice.trim() || practice.trim().length > 100} className={btn.secondary} onClick={() => { setTitle(practice.trim()); setApplied('가져올 중국어 제목에 적용했습니다.'); }}>제목에 적용 (교체)</button>
        <button type="button" disabled={!practice.trim() || practice.trim().length > 100} className={btn.secondary} onClick={() => { setCover(practice.trim()); setApplied('썸네일 문구에 적용했습니다.'); }}>표지에 적용 (교체)</button>
        <button type="button" disabled={!practice.trim() || appendPractice(body, practice).length > 10000} className={btn.secondary} onClick={() => { setBody(appendPractice(body, practice)); setApplied('가져올 본문 끝에 추가했습니다.'); }}>본문 끝에 추가</button>
      </div>
      <p className="text-xs text-muted">제목·표지는 100자까지입니다. 저장 전 내용은 이 화면에서만 유지되며, 새로고침하거나 선택·AI 입력을 바꾸면 초기화됩니다. 직접 수정한 문장은 한국어 확인본과 다를 수 있습니다.</p>
      <p role="status" className="text-xs">{applied}</p>
    </section>}
    {accounts.length === 0 ? <div className="space-y-2 text-sm">
      <p>먼저 내 계정을 설정하세요. 새 창에서 설정한 뒤 계정 목록을 갱신하면 이 초안을 그대로 가져올 수 있습니다.</p>
      <a href="/app/accounts/new" target="_blank" rel="noopener noreferrer" className={btn.secondary}>새 창에서 계정 설정</a>
      <button type="button" className={btn.secondary} onClick={() => router.refresh()}>계정 목록 갱신</button>
    </div> : <form action={action} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      <label className="block text-sm">저장할 계정<select name="accountId" className={input}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="block text-sm">기획 이름<input name="name" required maxLength={200} defaultValue={result?.titles[0]?.ko ?? `${source.category} 사전 활용 기획`} className={input} /></label>
      {result && <label className="block text-sm">제목 후보 선택<select className={input} defaultValue="0" onChange={e => setTitle(result.titles[Number(e.target.value)]?.zh ?? '')}>{result.titles.map((t, i) => <option value={i} key={i}>{t.kind} · {t.ko}</option>)}</select></label>}
      <label className="block text-sm">가져올 중국어 제목<input name="title" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} className={`${input} zh`} /></label>
      <label className="block text-sm">썸네일 문구 (선택)<input name="cover" value={cover} onChange={e => setCover(e.target.value)} maxLength={100} placeholder="표지에 넣을 짧은 중국어 문구" className={`${input} zh`} /></label>
      <label className="block text-sm">가져올 중국어 본문<textarea aria-label="가져올 중국어 본문" value={body} onChange={e => setBody(e.target.value)} rows={5} maxLength={10000} className={`${input} zh`} /></label>
      <p className="text-xs text-muted">중국어 본문·한국어 확인본·태그를 함께 저장합니다. 경험과 촬영 장면은 기획실에서 직접 확인해 주세요.</p>
      {state.error && <p role="alert" className="text-sm text-accent">{state.error}</p>}
      <button disabled={pending} className={btn.primary}>{pending ? '저장 중…' : '비공개 기획으로 저장'}</button>
    </form>}
  </section>;
}
