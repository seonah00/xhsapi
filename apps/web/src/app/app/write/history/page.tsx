import Link from 'next/link';
import {writingPage} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {PageHeader,Empty,btn,input,Notice} from '@/components/ui';
import {fmtDate} from '@/components/labels';
import {LibraryPagination} from '@/components/library-pagination';
import {WritingManagement} from '@/components/writing-management';
export default async function History({searchParams}:{searchParams:Promise<{q?:string;state?:string;page?:string;notice?:string}>}) {
 const sp=await searchParams,q=(sp.q??'').slice(0,100),state=sp.state==='archived'?'archived':'active';
 const result=await withPageCtx(ctx=>writingPage(ctx,{q,state,page:Number(sp.page??1)}));
 const params={q,state};
 return <><PageHeader title="작성 이력" description="저장한 글을 찾고, 복제하거나 보관하세요. 보관한 글은 다시 꺼낼 수 있습니다." actions={<Link className={`${btn.primary} min-h-11`} href="/app/write">새 글쓰기</Link>}/>
 {sp.notice==='archived'&&<Notice>글을 보관함으로 옮겼습니다. 글과 이전 버전은 유지됩니다.</Notice>}
 <nav aria-label="작성물 목록" className="my-4 flex gap-2">{(['active','archived'] as const).map(value=><Link key={value} aria-current={state===value?'page':undefined} className={`${state===value?btn.primary:btn.secondary} min-h-11`} href={`/app/write/history?${new URLSearchParams({q,state:value})}`}>{value==='active'?'작성 중인 글':'보관함'}</Link>)}</nav>
 <form className="mb-4 flex flex-col gap-2 sm:flex-row"><input type="hidden" name="state" value={state}/><label className="min-w-0 flex-1"><span className="mb-1 block text-sm">작성물 검색</span><input name="q" defaultValue={q} maxLength={100} placeholder="제목·본문·한국어 확인본·태그" className={input}/></label><button className={`${btn.secondary} min-h-11 sm:self-end`}>검색</button>{q&&<Link className={`${btn.secondary} min-h-11 sm:self-end`} href={`/app/write/history?state=${state}`}>검색 초기화</Link>}</form>
 <LibraryPagination label="작성 이력 페이지" path="/app/write/history" {...result} params={params}/>
 {!result.items.length&&<Empty title={q?'검색 결과가 없습니다':state==='archived'?'보관한 글이 없습니다':'저장한 글이 없습니다'}>검색어를 바꾸거나 새 글을 작성해 보세요.</Empty>}
 <ul className="space-y-3">{result.items.map(row=><li key={row.id} className="min-w-0 break-words rounded-xl border border-line p-4"><Link href={`/app/write/history/${row.id}`} className="block py-2 font-semibold text-accent">{row.title||'제목 없는 글'}</Link><p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted">{row.body||'본문 없음'}</p><p className="mt-2 text-xs text-muted">버전 {row.revision} · {fmtDate(row.updated_at.toISOString(),true)}</p><WritingManagement compact id={row.id} revision={row.revision} archived={Boolean(row.archived_at)}/></li>)}</ul>
 {result.pages>1&&<LibraryPagination label="작성 이력 하단 페이지" path="/app/write/history" {...result} params={params}/>}</>;
}
