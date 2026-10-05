import Link from 'next/link';
import { createCollection, listCollections, listReferences, ReferenceListQuery } from '@xhs/core';
import { redirect } from 'next/navigation';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, DemoBadge, Empty, ErrorNotice, input, selectAuto, LinkButton, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '레퍼런스' };
const SOURCE: Record<string, string> = { saved_note: '저장한 노트', manual_url: '링크', pasted_text: '붙여넣은 텍스트', image: '이미지' };

async function newCollection(f: FormData) {
  'use server';
  await orRedirectWithError('/app/references', () => withPageCtx((ctx) => createCollection(ctx, String(f.get('name') ?? ''))));
  redirect('/app/references');
}

export default async function References({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = ReferenceListQuery.safeParse({ q: sp.q || undefined, collectionId: sp.collection || undefined, favorite: sp.favorite || undefined, trash: sp.trash || undefined, sort: sp.sort || undefined });
  const { refs, collections } = await withPageCtx(async (ctx) => ({ refs: await listReferences(ctx, q.success ? q.data : {}), collections: await listCollections(ctx) }));
  const trash = sp.trash === '1';
  return (
    <>
      <PageHeader title={trash ? '휴지통' : '레퍼런스 라이브러리'} description="내 레퍼런스는 기본 비공개입니다. 링크를 저장해도 자동으로 크롤링하지 않습니다."
        actions={<><LinkButton href="/app/references/new" variant="primary">+ 직접 추가</LinkButton>{trash ? <LinkButton href="/app/references">목록으로</LinkButton> : <LinkButton href="/app/references?trash=1">휴지통</LinkButton>}</>} />
      <ErrorNotice message={sp.error} />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <nav aria-label="컬렉션" className="rounded-2xl border border-line bg-surface p-3 text-sm">
            <p className="mb-2 font-semibold">컬렉션</p>
            <ul className="space-y-1">
              <li><Link href="/app/references" className="hover:text-accent">전체</Link></li>
              <li><Link href="/app/references?favorite=1" className="hover:text-accent">★ 즐겨찾기</Link></li>
              {collections.map((c) => <li key={c.id}><Link href={`/app/references?collection=${c.id}`} className="hover:text-accent">{c.name} <span className="text-muted">({c.count})</span></Link></li>)}
            </ul>
            <form action={newCollection} className="mt-3 flex gap-1">
              <label className="sr-only" htmlFor="cname">새 컬렉션 이름</label>
              <input id="cname" name="name" required maxLength={80} placeholder="새 컬렉션" className={`${input} py-1.5 text-xs`} />
              <button className={btn.small}>추가</button>
            </form>
          </nav>
        </aside>
        <div>
          <form role="search" className="mb-3 flex flex-wrap gap-2">
            {trash && <input type="hidden" name="trash" value="1" />}
            <label className="sr-only" htmlFor="rq">검색</label>
            <input id="rq" name="q" defaultValue={sp.q} placeholder="제목·메모·태그 검색" className={`${input} max-w-xs`} />
            <select name="sort" defaultValue={sp.sort ?? 'updated'} className={selectAuto} aria-label="정렬">
              <option value="updated">최근 수정순</option><option value="created">최근 추가순</option><option value="title">제목순</option>
            </select>
            <button className={btn.secondary}>적용</button>
          </form>
          {refs.length === 0 ? <Empty title={trash ? '휴지통이 비었습니다' : '아직 레퍼런스가 없습니다'}>{!trash && '탐색에서 “레퍼런스로 가져오기”를 누르거나 직접 추가하세요.'}</Empty> : (
            <ul className="space-y-2">
              {refs.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/references/${r.id}`} className="block rounded-2xl border border-line bg-surface p-3 hover:border-accent">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge>{SOURCE[r.sourceType]}</Badge>
                      {r.note && <DemoBadge mode={r.note.dataMode} />}
                      {r.favorite && <Badge tone="warn">★</Badge>}
                      {r.collectionName && <Badge tone="info">{r.collectionName}</Badge>}
                      {r.tags.map((t) => <Badge key={t}>#{t}</Badge>)}
                    </div>
                    <p className="zh mt-1 font-medium">{r.title ?? r.note?.title ?? r.manualUrl ?? '제목 없음'}</p>
                    {r.userMemo && <p className="mt-0.5 line-clamp-1 text-sm text-muted">메모: {r.userMemo}</p>}
                    <p className="mt-1 text-xs text-muted">{fmtDate(r.updatedAt, true)} 수정</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
