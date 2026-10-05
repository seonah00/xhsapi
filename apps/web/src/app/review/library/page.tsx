import { redirect } from 'next/navigation';
import { listLibrary, listShareRequests, publishReference, unpublishReference } from '@xhs/core';
import { withStaff } from '@/server/staff';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, Empty, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '자료실 검토' };

async function publish(f: FormData) {
  'use server';
  await orRedirectWithError('/review/library', () => withStaff((ctx) => publishReference(ctx, String(f.get('id')), Number(f.get('revision')))));
  redirect('/review/library?published=1');
}
async function unpublish(f: FormData) {
  'use server';
  await orRedirectWithError('/review/library', () => withStaff((ctx) => unpublishReference(ctx, String(f.get('id')), String(f.get('reason') ?? ''))));
  redirect('/review/library');
}

export default async function LibraryReview({ searchParams }: { searchParams: Promise<{ error?: string; published?: string }> }) {
  const sp = await searchParams;
  const { requests, published } = await withStaff(async (ctx) => ({ requests: await listShareRequests(ctx), published: await listLibrary(ctx) }));
  return (
    <>
      <PageHeader title="자료실 검토" description="공유 동의가 있는 요청만 보입니다. 공개하면 현재 내용의 사본이 만들어지고, 이후 원본 수정은 반영되지 않습니다." />
      <ErrorNotice message={sp.error} />
      {sp.published && <div className="mb-3"><Notice tone="ok">공개했습니다.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">공유 요청</h2>
          {requests.length === 0 ? <div className="mt-2"><Empty title="대기 중인 요청이 없습니다" /></div> : (
            <ul className="mt-2 space-y-2">
              {requests.map((r) => (
                <li key={r.referenceId} className="rounded-xl bg-bg p-3 text-sm">
                  <p className="zh font-medium">{r.title ?? r.noteTitle ?? '제목 없음'}</p>
                  <p className="text-xs text-muted">{r.ownerEmail} · {fmtDate(r.requestedAt, true)} · 권리: {({ reference_only: '참고용(타인 콘텐츠)', own_content: '본인 콘텐츠', licensed: '사용 허락' } as Record<string, string>)[r.license]}</p>
                  {r.memo && <p className="mt-1">메모: {r.memo}</p>}
                  {r.license === 'reference_only' && <p className="mt-1 text-xs text-warn">타인 콘텐츠: 링크·제목·학생 메모만 공개되고 원문은 공유되지 않습니다.</p>}
                  <form action={publish} className="mt-2"><input type="hidden" name="id" value={r.referenceId} /><input type="hidden" name="revision" value={r.revision} /><button className={btn.small}>검토 후 공개</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">공개 중</h2>
          {published.length === 0 ? <p className="mt-2 text-sm text-muted">없음</p> : (
            <ul className="mt-2 space-y-2">
              {published.map((p) => (
                <li key={p.id} className="rounded-xl bg-bg p-3 text-sm">
                  <p className="zh font-medium">{p.title ?? '제목 없음'} <Badge>{fmtDate(p.publishedAt)}</Badge></p>
                  <form action={unpublish} className="mt-2 flex flex-wrap gap-2 text-xs">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="sr-only" htmlFor={`r-${p.id}`}>비공개 사유</label>
                    <input id={`r-${p.id}`} name="reason" required minLength={2} placeholder="비공개 사유(예: 권리 확인 필요)" className="rounded-lg border border-line bg-surface px-2 py-1" />
                    <button className={btn.small}>비공개</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
