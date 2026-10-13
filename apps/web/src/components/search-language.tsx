import { KeywordRecommendations } from './keyword-recommendations';
import { previewLanguage } from '@/app/app/discover/language/actions';
import { PendingButton } from './pending-button';
import Link from 'next/link';
import { analyzeSearchLanguage, recommendKeywords, type NoteCard, type SharedDictionaryEntry } from '@xhs/core';
import { CopyButton } from './copy-button';
import { fmtDate } from './labels';

export function SearchLanguage({ query, notes, dictionary }: { query: string; notes: NoteCard[]; dictionary: SharedDictionaryEntry[] }) {
  const analysis = analyzeSearchLanguage(notes, dictionary);
  return <section aria-labelledby="search-language-title" className="mb-4 rounded-2xl border border-line bg-surface p-4">
    <KeywordRecommendations key={query} result={recommendKeywords(query, notes, dictionary)} source={{query,noteIds:notes.map(n=>n.id)}}/>
    <h2 id="search-language-title" className="font-semibold">이 검색에서 발견한 해시태그·표현</h2>
    <p className="mt-1 text-sm text-muted">현재 페이지의 중복 제외 {analysis.sampleSize}개 게시물 기준 · 수집 관찰 {fmtDate(analysis.from)} ~ {fmtDate(analysis.to)}</p>
    <p className="mt-1 text-xs text-muted">샤오홍슈 전체 인기 순위나 작성자 국적을 뜻하지 않습니다. 정렬·필터·페이지에 따라 표본이 달라지며, 수집된 제목·본문 일부·태그만 분석합니다. 뜻과 주의사항은 공용사전 설명입니다.</p>
    <form action={previewLanguage} className="mt-3">
      <input type="hidden" name="task" value="interpret"/><input type="hidden" name="noteIds" value={notes.map(n=>n.id).join(',')}/>
      <PendingButton className="rounded-lg border border-line px-3 py-2 text-sm">사전에 없는 표현도 AI로 해석</PendingButton>
      <p className="text-xs text-muted">입력 길이 한도 내 게시물 발췌문에서 표현을 찾아 근거와 함께 해석합니다.</p>
    </form>
    {notes.some(n => n.dataMode === 'mock') && <p className="text-sm text-warn">데모 자료입니다. 실제 사용 빈도가 아닙니다.</p>}
    {(['tags', 'expressions'] as const).map(kind => <div key={kind} className="mt-4">
      <h3 className="font-medium">{kind === 'tags' ? '실제 발견한 해시태그' : '본문·제목에서 발견한 표현 / 줄임말 후보'}</h3>
      {kind === 'expressions' && <p className="text-xs text-muted">공용사전 표현과 영문 약어 형태를 찾습니다. 영문 단어·브랜드명일 수 있으며 모든 중국어 유행어를 탐지하지는 않습니다.</p>}
      {!analysis[kind].length ? <p className="mt-2 text-sm text-muted">이 표본에서 확인한 {kind === 'tags' ? '해시태그가' : '표현이'} 없습니다.</p> : <ul className="mt-2 grid gap-2 md:grid-cols-2">
        {analysis[kind].map(item => <li key={item.term} className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2"><strong lang="zh-CN">{kind === 'tags' ? '#' : ''}{item.term}</strong><CopyButton text={`${kind === 'tags' ? '#' : ''}${item.term}`} label="복사" /></div>
          <p className="text-sm">{item.noteCount}/{analysis.sampleSize}개 게시물에서 발견 · 식별 가능한 작성자 {item.authorCount}명</p>
          <p className="mt-1 text-sm">{item.meaning ?? '뜻 미확인 — 예문을 확인하세요.'}</p>
          {item.cautions.map(c => <p key={c} className="text-xs text-warn">{c}</p>)}
          <details className="mt-2 text-sm"><summary className="cursor-pointer">근거 게시물·사용 문맥</summary><ul className="mt-2 space-y-2">{item.examples.map(e => <li key={e.noteId}><Link href={`/app/notes/${e.noteId}`} className="underline" lang="zh-CN">{e.title}</Link><p className="zh break-words text-muted" lang="zh-CN">{e.context}</p></li>)}</ul></details>
        </li>)}
      </ul>}
    </div>)}
  </section>;
}
