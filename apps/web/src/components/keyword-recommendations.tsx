'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { recommendKeywords } from '@xhs/core';
import { searchAutomatically } from '@/app/app/discover/actions';
import { PendingButton } from './pending-button';
import { CopyButton } from './copy-button';

export function KeywordRecommendations({ result }: { result: ReturnType<typeof recommendKeywords> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [audience, setAudience] = useState('');
  const [situation, setSituation] = useState('');
  const custom = `${audience.trim()}${situation.trim()}${result.zh}`;
  return <div className="mb-6 border-b border-line pb-5">
    <h2 className="font-semibold">사전과 검색 결과로 키워드 정리</h2>
    <p className="mt-1 text-sm text-muted">내가 등록해 공개한 공용사전과 현재 검색 표본을 함께 확인합니다. 추천 후보는 검색 방향 제안이며 실사용·인기도가 확인된 해시태그가 아닙니다. 사전의 과거 관찰 수는 현재 빈도에 합산하지 않습니다.</p>
    {(['core', 'related', 'longTail'] as const).map(group => <section key={group} className="mt-4">
      <h3 className="font-medium">{{ core: '핵심 키워드', related: '연관 키워드 · 함께 발견한 태그', longTail: '롱테일 키워드 · 대상과 상황을 구체화' }[group]}</h3>
      {!result.items.some(item => item.group === group) && <p className="text-sm text-muted">아직 추천 근거가 없습니다. 아래에서 대상·상황을 지정하거나 다른 검색 결과를 확인하세요.</p>}
      <ul className="mt-2 grid gap-2 md:grid-cols-2">{result.items.filter(item => item.group === group).map(item => <li key={item.term} className="rounded-xl border border-line p-3">
        <label className="flex gap-2"><input type="checkbox" checked={selected.includes(item.term)} onChange={e => setSelected(current => e.target.checked ? [...current, item.term] : current.filter(t => t !== item.term))}/><span lang="zh-CN">#{item.term}</span></label>
        <p className="text-xs text-muted">{item.dictionaryIds.length ? '공용사전 수록 · ' : ''}{item.noteCount ? `현재 표본 ${item.noteCount}/${result.sampleSize}건에서 발견` : '실사용 미확인 · 검색 후보'}</p>
        {item.meaning && <p className="text-sm">{item.meaning}</p>}
        {item.cautions.map((c, i) => <p key={i} className="text-xs text-warn">{c}</p>)}
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <form action={searchAutomatically}><input type="hidden" name="q" value={item.term}/><PendingButton className="underline">이 키워드로 게시물 찾기</PendingButton></form>
          {!!item.dictionaryIds.length && <Link href={`/app/dictionary?q=${encodeURIComponent(item.term)}`} className="underline">사전에서 활용하기</Link>}
          {item.evidence[0] && <Link href={`/app/notes/${item.evidence[0].noteId}`} className="underline">사용 근거 보기</Link>}
        </div>
      </li>)}</ul>
    </section>)}
    <div className="mt-4 space-y-2">
      <p className="text-sm">다른 주제도 중국어 대상·상황을 붙여 롱테일 검색어를 만들 수 있습니다. 조합 뒤 문맥을 확인하세요.</p>
      <label className="block text-sm">대상 (예: 敏感肌)<input className="ml-2 rounded border border-line p-2" value={audience} maxLength={20} onChange={e => setAudience(e.target.value)}/></label>
      <label className="block text-sm">상황 (예: 夏季)<input className="ml-2 rounded border border-line p-2" value={situation} maxLength={20} onChange={e => setSituation(e.target.value)}/></label>
      {(audience || situation) && <form action={searchAutomatically}><input type="hidden" name="q" value={custom}/><p lang="zh-CN">{custom} · 실사용 미확인</p><PendingButton disabled={!result.zh || custom.length > 50 || /[가-힣]/.test(custom)} className="underline">조합한 키워드로 게시물 찾기</PendingButton></form>}
      {!!selected.length && <CopyButton text={selected.map(t => `#${t}`).join(' ')} label={`선택한 ${selected.length}개 태그 복사`}/>}
      <p className="text-xs text-muted">추가 검색은 버튼을 누른 키워드만 기존 검색 한도 안에서 실행합니다. 선택한 태그는 본문·기획 초안에 붙여 넣어 활용할 수 있습니다.</p>
    </div>
  </div>;
}
