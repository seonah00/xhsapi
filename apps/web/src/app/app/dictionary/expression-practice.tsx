'use client';
import { useId, useState } from 'react';
import type { SharedDictionaryEntry } from '@xhs/core';
import { CopyButton } from '@/components/copy-button';
import { expressionGuide } from './expression-guides';

export function ExpressionPractice({ entries }: { entries: SharedDictionaryEntry[] }) {
  const sentenceId = useId();
  const [sentence, setSentence] = useState('');
  return <section aria-label="표현 활용 가이드" className="mt-4 space-y-3 rounded-xl border border-line p-3">
    <h3 className="font-semibold">선택한 표현으로 문장 연습</h3>
    {entries.filter(e => e.entryType === 'expression').map(entry => {
      const guide = expressionGuide(entry.term);
      return <details key={entry.id}><summary>{entry.term} 활용 보기</summary>
        <p>{entry.meaning}</p>
        {guide ? <><p>사용 상황: {guide.situation}</p><p>뉘앙스: {guide.nuance}</p><p>주의: {guide.avoid}</p><p lang="zh-CN">{guide.zh}</p><p>{guide.ko}</p><p className="text-xs text-muted">학습용 창작 예문입니다. 실제 게시물 인용이 아닙니다.</p><button type="button" onClick={() => setSentence(guide.zh)} className="underline">이 예문으로 연습</button></> : <p>공개 사전 설명과 실제 게시물 문맥을 참고해 문장을 작성하세요.</p>}
      </details>;
    })}
    <label htmlFor={sentenceId} className="block">내 소재로 바꾼 문장</label><textarea id={sentenceId} className="mt-1 w-full rounded border border-line p-2" value={sentence} maxLength={3000} onChange={e => setSentence(e.target.value)}/>
    {sentence.trim() && <CopyButton text={sentence} label="문장 복사"/>}
    <p className="text-xs text-muted">복사한 문장은 다른 작성 사이트에서 사용할 수 있습니다.</p>
  </section>;
}
