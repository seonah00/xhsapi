import Link from 'next/link';
import Form from 'next/form';
import { listDictionaryPlanHistory } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { btn, Card, Empty, input, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '내 사전 사용 이력' };

export default async function DictionaryHistory({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 120);
  const p = Number(sp.page ?? 1);
  const result = await withPageCtx(ctx => listDictionaryPlanHistory(ctx, { query: q, page: Number.isInteger(p) && p > 0 ? Math.min(p, 100000) : 1 }));
  const href = (page: number) => `/app/dictionary/history?${new URLSearchParams({ q, page: String(page) })}`;
  return <>
    <PageHeader title="내 사전 사용 이력" description="사전 항목을 선택해 내 비공개 기획으로 가져온 기록입니다. 실제 발행이나 최종 문구 사용 여부를 뜻하지 않습니다."
      actions={<Link href="/app/dictionary" className={btn.secondary}>공용사전으로</Link>} />
    <Form action="/app/dictionary/history" role="search" className="mb-4 flex gap-2">
      <label className="sr-only" htmlFor="history-query">가져온 표현·태그 검색</label>
      <input id="history-query" name="q" defaultValue={q} key={q} maxLength={120} placeholder="가져온 표현·태그 검색" className={input} />
      <button className={btn.primary}>검색</button>
    </Form>
    <p className="mb-3 text-sm text-muted">기획 {result.total}개 · {result.page}/{result.pages}페이지 · 가져온 날짜 최신순</p>
    {result.items.length === 0 && <Empty title="가져온 기록이 없습니다">공용사전에서 항목을 선택하고 비공개 기획으로 저장하면 여기에 표시됩니다. 검색 중이라면 검색어를 바꿔 보세요.</Empty>}
    <div className="space-y-3">{result.items.map(item => <Card key={item.id}>
      <h2 className="font-semibold"><Link href={`/app/plans/${item.id}`} className="underline underline-offset-4">{item.title}</Link></h2>
      <p className="mt-1 text-xs text-muted">가져온 날 {fmtDate(item.createdAt, true)} · 마지막 수정 {fmtDate(item.updatedAt, true)}</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label={`${item.title}에 가져온 항목`}>{item.entries.map((entry, i) => <li key={`${entry.entryType}:${entry.term}:${i}`}>
        <Link href={`/app/dictionary?q=${encodeURIComponent(entry.term)}&entryType=${entry.entryType}`} className={btn.small}>{entry.entryType === 'tag' ? '태그' : '표현'} · {entry.term}</Link>
      </li>)}</ul>
      <p className="mt-2 text-xs text-muted">저장 당시의 선택 항목입니다. 사전에서 공개가 종료된 항목은 다시 검색되지 않을 수 있습니다.</p>
    </Card>)}</div>
    {result.pages > 1 && <nav aria-label="사용 이력 페이지" className="mt-4 flex gap-2">
      {result.page > 1 && <Link href={href(result.page - 1)} className={btn.secondary}>이전</Link>}
      {result.page < result.pages && <Link href={href(result.page + 1)} className={btn.secondary}>다음</Link>}
    </nav>}
  </>;
}
