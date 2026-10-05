import { listLibrary } from '@xhs/core';
import { safeExternalHref } from '@xhs/security';
import { withPageCtx } from '@/server/ctx';
import { Badge, btn, DemoBadge, Empty, input, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '공통 자료실' };

export default async function Library({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const items = await withPageCtx((ctx) => listLibrary(ctx, q?.slice(0, 50)));
  return (
    <>
      <PageHeader title="공통 자료실" description="수강생이 동의해 공유하고 강사·관리자가 검토한 자료의 사본입니다. 타인의 원문·미디어는 재배포하지 않고 링크와 메모만 공유합니다." />
      <form role="search" className="mb-4 flex gap-2"><label className="sr-only" htmlFor="lq">검색</label><input id="lq" name="q" defaultValue={q} placeholder="제목·메모·태그" className={`${input} max-w-xs`} /><button className={btn.secondary}>검색</button></form>
      {items.length === 0 ? <Empty title="공개된 자료가 없습니다" /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((i) => {
            const href = i.url ? safeExternalHref(i.url) : null;
            return (
              <li key={i.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-1"><DemoBadge mode={i.dataMode} /><Badge>{({ saved_note: '노트', manual_url: '링크', pasted_text: '텍스트' } as Record<string, string>)[i.sourceType] ?? i.sourceType}</Badge>{i.tags.map((t) => <Badge key={t}>#{t}</Badge>)}</div>
                <p className="zh mt-2 font-medium">{i.title ?? '제목 없음'}</p>
                {i.memo && <p className="mt-1 text-sm">메모: {i.memo}</p>}
                {i.userText && <p className="zh mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-muted">{i.userText}</p>}
                <p className="mt-2 text-xs text-muted">공개 {fmtDate(i.publishedAt)}{href && !href.includes('.invalid') && <> · <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">원문 ↗</a></>}</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
