'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DictionaryAiInput, DictionaryAiResult, SharedDictionaryEntry } from '@xhs/core';
import { btn, input } from '@/components/ui';
import { dictionaryPlanAction } from './actions';

export type PlanAccount = { id: string; name: string };
export function DictionaryPlanImport({ entries, source, result, accounts }: {
  entries: SharedDictionaryEntry[]; source: DictionaryAiInput;
  result?: DictionaryAiResult | undefined; accounts: PlanAccount[];
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(dictionaryPlanAction, {});
  const [title, setTitle] = useState(result?.titles[0]?.zh ?? '');
  const payload = JSON.stringify({
    requestId, entryIds: entries.map(e => e.id), notes: source.notes,
    mode: source.mode, disclosure: source.disclosure,
    content: {
      body: result?.bodyZh ?? '', meaningKo: result?.bodyKo ?? '',
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
      <label className="block text-sm">썸네일 문구 (선택)<input name="cover" maxLength={100} placeholder="표지에 넣을 짧은 중국어 문구" className={`${input} zh`} /></label>
      <p className="text-xs text-muted">중국어 본문·한국어 확인본·태그를 함께 저장합니다. 경험과 촬영 장면은 기획실에서 직접 확인해 주세요.</p>
      {state.error && <p role="alert" className="text-sm text-accent">{state.error}</p>}
      <button disabled={pending} className={btn.primary}>{pending ? '저장 중…' : '비공개 기획으로 저장'}</button>
    </form>}
  </section>;
}
