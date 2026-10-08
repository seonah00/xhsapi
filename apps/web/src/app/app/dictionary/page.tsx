import Link from 'next/link';
import Form from 'next/form';
import { getDictionaryAiStatus, listSharedDictionary, type DictionaryEntryType } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { Badge, btn, Empty, ErrorNotice, input, PageHeader } from '@/components/ui';
import { DictionaryWorkspace } from './workspace';
import { getDictionaryAiConfig } from '@/server/dictionary-ai-config';

export const metadata = { title: '공용 사전' };

const PAGE_SIZE = 24;
type Search = { q?: string; entryType?: string; category?: string; page?: string; error?: string };
type SearchPatch = Omit<Partial<Search>, 'entryType'> & { entryType?: string | null };

function hrefFor(sp: Search, patch: SearchPatch) {
  const next = { ...sp, ...patch };
  const qs = new URLSearchParams();
  if (next.q) qs.set('q', next.q);
  if (next.entryType === 'tag' || next.entryType === 'expression') qs.set('entryType', next.entryType);
  if (next.category) qs.set('category', next.category);
  if (next.page && next.page !== '1') qs.set('page', next.page);
  return `/app/dictionary${qs.size ? `?${qs}` : ''}`;
}

export default async function SharedDictionary({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const entryType: DictionaryEntryType | undefined = sp.entryType === 'tag' || sp.entryType === 'expression' ? sp.entryType : undefined;
  const parsedPage = Number.parseInt(sp.page ?? '1', 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const { result, aiStatus } = await withPageCtx(async (ctx) => ({
    result: await listSharedDictionary(ctx, {
      ...(sp.q?.trim() ? { query: sp.q.trim() } : {}),
      ...(entryType ? { entryType } : {}),
      ...(sp.category?.trim() ? { category: sp.category.trim() } : {}),
      page: requestedPage,
      pageSize: PAGE_SIZE,
    }),
    aiStatus: await getDictionaryAiStatus(ctx, getDictionaryAiConfig()),
  }));
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader title="공용 사전" description="운영자가 검토해 공개한 태그와 표현을 검색하고, 작성에 참고할 항목을 선택할 수 있습니다." />
      <ErrorNotice message={sp.error} />
      <div role="note" className="mb-4 rounded-xl bg-info-soft px-4 py-3 text-sm text-info">
        이 목록은 편집된 관찰 자료이며 인기 순위, 검색량, 성과 보장을 뜻하지 않습니다. 개인 초안이나 AI 생성 결과는 자동으로 공용 사전에 공유되지 않습니다.
      </div>

      <Form action="/app/dictionary" key={JSON.stringify([sp.q, entryType, sp.category])} role="search" className="grid gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="sr-only" htmlFor="dictionary-query">태그·표현·뜻 검색</label>
        <input id="dictionary-query" name="q" defaultValue={sp.q} maxLength={100} placeholder="태그·표현·뜻 검색" className={input} />
        <select name="entryType" defaultValue={entryType ?? ''} aria-label="항목 종류" className={input}>
          <option value="">태그와 표현 전체</option>
          <option value="tag">태그</option>
          <option value="expression">표현</option>
        </select>
        <label className="sr-only" htmlFor="dictionary-category">카테고리</label>
        <input id="dictionary-category" name="category" defaultValue={sp.category} maxLength={80} placeholder="카테고리 필터" className={input} />
        <button className={btn.primary}>검색</button>
      </Form>

      <div className="my-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={hrefFor(sp, { entryType: null, page: '1' })} className={entryType ? btn.small : btn.primary}>전체 {result.counts.tags + result.counts.expressions}</Link>
          <Link href={hrefFor(sp, { entryType: 'tag', page: '1' })} className={entryType === 'tag' ? btn.primary : btn.small}>태그 {result.counts.tags}</Link>
          <Link href={hrefFor(sp, { entryType: 'expression', page: '1' })} className={entryType === 'expression' ? btn.primary : btn.small}>표현 {result.counts.expressions}</Link>
        </div>
        <p className="text-xs text-muted">검색 결과 {result.total.toLocaleString()}개 · {result.page}/{totalPages}페이지</p>
      </div>

      {result.items.length === 0 && <Empty title="조건에 맞는 항목이 없습니다">검색어나 카테고리 필터를 바꿔 보세요.</Empty>}
      <DictionaryWorkspace items={result.items} aiStatus={aiStatus} />

      {totalPages > 1 && (
        <nav aria-label="사전 페이지" className="mt-5 flex items-center justify-center gap-2">
          {result.page > 1 ? <Link className={btn.secondary} href={hrefFor(sp, { page: String(result.page - 1) })}>이전</Link> : <span className={`${btn.secondary} pointer-events-none opacity-40`}>이전</span>}
          <Badge>{result.page} / {totalPages}</Badge>
          {result.page < totalPages ? <Link className={btn.secondary} href={hrefFor(sp, { page: String(result.page + 1) })}>다음</Link> : <span className={`${btn.secondary} pointer-events-none opacity-40`}>다음</span>}
        </nav>
      )}
    </>
  );
}
