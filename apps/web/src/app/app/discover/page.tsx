import Link from 'next/link';
import { categorySearch } from '@/components/category-search';
import { discover, DiscoverQuery, getQuote, requestHash } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { confirmRefresh, getCompareIds, quoteRefresh } from './actions';
import { JobStatus } from '@/components/job-status';
import { QuoteConfirm } from '@/components/quote-confirm';
import { PendingButton } from '@/components/pending-button';
import { CoverRepair } from '@/components/cover-repair';
import { NoteCard } from '@/components/note-card';
import { Badge, btn, Empty, ErrorNotice, input, PageHeader } from '@/components/ui';
import { FORMAT_LABEL, TOPIC_LABEL, fmtDate } from '@/components/labels';

export const metadata = { title: '탐색' };

type SP = { targetCount?: string; q?: string; topic?: string; format?: string; days?: string; sort?: string; terms?: string | string[]; cursor?: string; error?: string; refresh?: string; quote?: string; job?: string };

export default async function Discover({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const parsed = DiscoverQuery.safeParse({
    q: sp.q ?? '', topic: sp.topic || undefined, format: sp.format || undefined, days: sp.days || undefined, sort: sp.sort || undefined,
    terms: sp.terms ? ([] as string[]).concat(sp.terms) : undefined, cursor: sp.cursor,
  });
  const query = parsed.success ? parsed.data : DiscoverQuery.parse({});
  const [[result, quote, mode, canManage], compare] = await Promise.all([
    withPageCtx(async (ctx) => [await discover(ctx, query), sp.quote && /^[0-9a-f-]{36}$/.test(sp.quote) ? await getQuote(ctx, sp.quote) : null, ctx.mode, ctx.role === 'org_admin'] as const),
    getCompareIds(),
  ]);
  const qs = new URLSearchParams(Object.entries({ q: sp.q ?? '', topic: sp.topic ?? '', format: sp.format ?? '', days: sp.days ?? '', sort: sp.sort ?? '' }).filter(([, v]) => v));
  const searchQuery = categorySearch(sp.q, sp.topic);
  const targetCount = sp.targetCount === '100' ? '100' : '50';
  const quoteScope = {query:searchQuery,targetCount:Number(targetCount),...(sp.topic?{topic:sp.topic}:{}),...(sp.days?{days:Number(sp.days)}:{})};
  const quoteMatches = quote?.operation === 'provider_search' && quote.requestHash === requestHash('provider_search',quoteScope);
  const back = `/app/discover${qs.size ? `?${qs}` : ''}`;
  return (
    <>
      <PageHeader title="탐색" description={<>먼저 저장된 게시물을 찾습니다. 더 많은 게시물은 아래 “새 게시물 찾기”에서 조회하세요. 마지막 갱신 {fmtDate(result.lastFetchedAt, true)}</>}
        actions={<><Link href="/app/reference-accounts" className={btn.secondary}>참고 계정</Link><Link href="/app/discover/compare" className={btn.secondary}>비교 ({compare.length}/3)</Link></>} />
      <ErrorNotice message={sp.error ?? (parsed.success ? undefined : '검색 조건을 확인하세요.')} />
      <form role="search" className="mb-4 grid gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <label className="sr-only" htmlFor="q">검색어</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="한국어 또는 중국어 (예: 스킨케어, 护肤)" className={input} />
        <select name="topic" defaultValue={sp.topic ?? ''} className={input} aria-label="주제"><option value="">모든 주제</option>{Object.entries(TOPIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="format" defaultValue={sp.format ?? ''} className={input} aria-label="형식"><option value="">모든 형식</option>{Object.entries(FORMAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="sort" defaultValue={sp.sort ?? 'popular'} className={input} aria-label="정렬"><option value="popular">좋아요 많은 순</option><option value="saves">저장 많은 순</option><option value="recent">최신순</option></select>
        <select name="days" defaultValue={sp.days ?? ''} className={input} aria-label="기간"><option value="">전체 기간</option><option value="7">최근 7일</option><option value="14">최근 14일</option><option value="30">최근 30일</option></select>
        <button className={btn.primary}>저장된 게시물 검색</button>
      </form>

      {result.expansion && (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-3 text-sm">
          <p><span className="text-muted">원문</span> <strong>{result.expansion.original}</strong> → <span className="text-muted">중국어 후보(편집 시드 사전)</span></p>
          {result.expansion.candidates.length > 0 && (
            <form className="mt-2 flex flex-wrap items-center gap-2">
              {Object.entries({ q: sp.q, topic: sp.topic, format: sp.format, days: sp.days, sort: sp.sort }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
              {result.expansion.candidates.map((c) => (
                <label key={c.text} className="zh inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                  <input type="checkbox" name="terms" value={c.text} defaultChecked={result.searchedTerms.includes(c.text)} /> {c.text}
                </label>
              ))}
              <button className={btn.small}>선택한 후보로 검색</button>
            </form>
          )}
          {result.expansion.unmatched.length > 0 && <p className="mt-2 text-warn">사전에 없는 단어: {result.expansion.unmatched.join(', ')} — 중국어로 직접 검색해 보세요.</p>}
          <p className="mt-1 text-xs text-muted">실제 검색에 사용: <span className="zh">{result.searchedTerms.join(', ') || '없음'}</span></p>
        </div>
      )}
      {sp.topic && !sp.cursor && result.notes.length < 50 && <p className="mb-3 text-sm text-muted">이 조건에 맞는 게시물 {result.notes.length}건 · 목표 50건. 아래 ‘새 게시물 찾기’에서 해당 주제를 추가 조회할 수 있습니다.</p>}
      {result.postFilters.length > 0 && <p className="mb-3 text-xs text-muted">기간 조건은 저장 자료에 사후 필터로 적용했습니다. 게시일이 확인되지 않은 자료는 제외됩니다.</p>}

      {(sp.q || sp.topic) && <div className="mb-4 rounded-xl bg-info-soft p-3 text-sm">
        현재 저장된 “{sp.q || TOPIC_LABEL[sp.topic ?? '']}” 관련 게시물입니다. <a href="#refresh" className="font-semibold underline">새 게시물 50건 찾기</a>
        {sp.job && <div className="mt-2"><JobStatus jobId={sp.job} label="새 게시물 찾기" /></div>}
      </div>}
      {result.notes.length === 0 ? (
        <Empty title="관련 근거가 부족합니다">조건에 맞는 저장 자료가 없습니다. 결과를 만들어 채우지 않았습니다. 검색어나 기간을 바꿔 보세요.</Empty>
      ) : (
        <CoverRepair canManage={canManage} key={back} notes={result.notes.map(n=>({id:n.id,coverUrl:n.coverUrl}))}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.notes.map((n) => <NoteCard canManage={canManage} key={n.id} note={n} back={back} inCompare={compare.includes(n.id)} />)}
        </div></CoverRepair>
      )}
      {result.nextCursor && <div className="mt-4 text-center"><Link className={btn.secondary} href={`${back}${qs.size ? '&' : '?'}cursor=${result.nextCursor}`}>더 보기</Link></div>}

      <div className="mt-8">
        <section id="refresh" aria-labelledby="refresh-title" className="rounded-2xl border border-line bg-surface p-4">
          <h2 id="refresh-title" className="font-semibold">새 게시물 찾기 {mode === 'mock' && <Badge tone="warn">데모</Badge>}</h2>
          <p className="mt-1 text-sm text-muted">
            저장된 자료가 부족할 때만 쓰세요. 비용·한도를 먼저 확인합니다. {mode === 'mock' ? '데모 모드에서는 외부로 요청하지 않고 합성 예시 자료만 추가됩니다.' : '조회 결과는 조직 안에서 함께 볼 수 있습니다.'}
          </p>
          {sp.refresh && quote && quoteMatches ? (
            <div className="mt-3"><QuoteConfirm quote={quote} title="외부 조회 확인" action={confirmRefresh}
              hidden={Object.fromEntries(Object.entries({ targetCount, q: searchQuery, topic: sp.topic ?? '', days: sp.days ?? '', back }).filter(([, v]) => v))} cancelHref={back}
              scopeLines={[`목표: 관련 게시물 ${targetCount}건 이상 · 최대 ${Math.ceil(Number(targetCount)/20)+2}페이지`, '중복을 제외하며 공급자 결과가 부족하면 목표보다 적을 수 있습니다. 화면 필터에 따라 표시 건수도 달라집니다.', '이미지 업데이트는 별도 비용 확인 후 실행합니다.', `검색어: ${searchQuery}`, `조건: ${sp.topic ? TOPIC_LABEL[sp.topic] ?? sp.topic : '모든 주제'} · ${sp.days ? `최근 ${sp.days}일` : '전체 기간'}`, '결과는 저장 자료에 추가되어 조직 안에서 다시 검색됩니다.']} /></div>
          ) : searchQuery ? (
            <form action={quoteRefresh} className="mt-3">
              {Object.entries({ q: searchQuery, topic: sp.topic, days: sp.days, back }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
              <label className="mr-2 text-sm">수집 목표 <select name="targetCount" defaultValue={targetCount} className={input}><option value="50">50건 이상</option><option value="100">100건 이상</option></select></label>
              <PendingButton className={btn.secondary} pendingText="견적 계산 중…">“{searchQuery}”로 비용 확인 후 조회</PendingButton>
            </form>
          ) : <p className="mt-2 text-sm text-muted">위에서 카테고리를 선택하거나 검색어를 입력하세요.</p>}
          {sp.job && <div className="mt-3"><p className="mt-1 text-xs text-muted">완료되면 <Link href={back} className="underline">검색 결과 새로고침</Link></p></div>}
        </section>
      </div>
      {result.latestHot.length > 0 && (
        <section aria-labelledby="hot" className="mt-6">
          <h2 id="hot" className="text-sm font-semibold">공급자 최신 인기 글 <Badge tone="warn">검색어와 무관</Badge></h2>
          <p className="mb-2 text-xs text-muted">검색 결과가 아니며 추천·집계에서 제외됩니다.</p>
          <ul className="space-y-1 text-sm">{result.latestHot.map((n) => <li key={n.id} className="zh text-muted" lang="zh-CN">{n.title}</li>)}</ul>
        </section>
      )}
    </>
  );
}
