'use client';
import { useState } from 'react';
import { btn, input } from '@/components/ui';

import { recommendEntries, type RecommendationEntry as Entry } from './recommend';
export function RediPicker({ items }: { items: Entry[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Entry[]>([]);
  const [message, setMessage] = useState('');
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const ranked = recommendEntries(items, query);
  async function send() {
    const entries = selected.map(item => ({ id: item.id, entryType: item.entryType, term: item.term, meaning: item.meaning, usage: item.usage, cautions: item.cautions }));
    try {
      await navigator.clipboard.writeText(JSON.stringify({ type: 'xhs-dictionary-selection', entries }));
      setMessage('복사했습니다. REDi의 선택 자료 붙여넣기에 붙여 넣고 가져오기를 누르세요.');
    } catch { setMessage('복사 권한이 없어 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.'); }
  }
  return <section className="space-y-5 pb-24">
    <label className="block">주제나 한국어 뜻<input className={`${input} mt-2 w-full`} value={query} maxLength={100} onChange={e => setQuery(e.target.value)} placeholder="예: 피부, 카페, 서울"/></label>
    <p className="text-sm text-muted">단어가 일치하는 항목을 표시합니다. 뜻·사용 상황·주의사항을 확인해 선택하세요.</p>
    {(['expression', 'tag'] as const).map(kind => <section key={kind}><h2 className="mb-3 font-semibold">{kind === 'expression' ? '표현 추천' : '해시태그 추천'}</h2><div className="grid gap-3 sm:grid-cols-2">{ranked.filter(row => row.item.entryType === kind).slice(0, 5).map(({ item }) => <label key={item.id} className="rounded-xl border border-line bg-surface p-4"><span className="flex gap-3"><input type="checkbox" checked={selected.some(entry => entry.id === item.id)} disabled={selected.length >= 10 && !selected.some(entry => entry.id === item.id)} onChange={e => { setMessage(''); setSelected(prev => e.target.checked ? [...prev, item].slice(0, 10) : prev.filter(entry => entry.id !== item.id)); }}/><strong>{item.term}</strong></span><p className="mt-2">{item.meaning}</p>{item.usage && <p className="mt-2 text-sm">{item.usage}</p>}{item.cautions.map(caution => <p key={caution} className="mt-2 text-sm text-warn">{caution}</p>)}</label>)}</div></section>)}
    {!ranked.length && <p>{words.length ? '일치하는 항목이 없습니다. 짧은 핵심 단어로 바꿔 보세요.' : '주제를 입력하면 표현과 태그를 각각 최대 5개 추천합니다.'}</p>}
    <div className="sticky bottom-4 rounded-xl border border-line bg-surface p-4"><p className="mb-2">선택 {selected.length}/10 · {selected.map(entry => entry.term).join(', ') || '선택 없음'}</p><button type="button" className={btn.primary} onClick={send}>REDi용 선택 자료 복사</button><button type="button" className={`${btn.secondary} ml-2`} onClick={() => setSelected([])}>선택 해제</button><p role="status" className="mt-2">{message}</p></div>
  </section>;
}
