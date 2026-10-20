import Link from 'next/link';
import {getWriting} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {WritingEditor} from '@/components/writing-editor';
import {PageHeader,btn,Notice} from '@/components/ui';
import {fmtDate} from '@/components/labels';
import {WritingManagement,RestoreWriting} from '@/components/writing-management';
import {LibraryPagination} from '@/components/library-pagination';
export default async function SavedWriting({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{versions?:string;restored?:string;notice?:string}>}) {
 const {id}=await params,sp=await searchParams;
 const {draft,versions,versionPaging}=await withPageCtx(ctx=>getWriting(ctx,id,Number(sp.versions??1)));
 return <><PageHeader title={draft.archivedAt?'보관한 글':'저장한 글 수정'} description="이전 버전으로 복원해도 현재 저장본과 모든 이력은 유지됩니다." actions={<Link href="/app/write/history" className={`${btn.secondary} min-h-11`}>작성 이력 목록</Link>}/>
 {sp.restored===String(draft.revision)&&<Notice>이전 내용으로 새 버전 {draft.revision}을 저장했습니다.</Notice>}{sp.notice==='copied'&&<Notice>별도 글로 복제했습니다. 원래 글은 유지됩니다.</Notice>}{sp.notice==='unarchived'&&<Notice>보관함에서 꺼냈습니다.</Notice>}
 <p className="break-words text-sm">사용한 항목: {draft.entries.map(e=>e.term).join(' · ')||'없음'}</p><WritingManagement id={id} revision={draft.revision} archived={Boolean(draft.archivedAt)}/>
 {draft.archivedAt?<section aria-label="보관한 글 내용" className="my-4 space-y-3 break-words rounded-xl border border-line p-4"><h2 className="font-semibold">{draft.title||'제목 없는 글'}</h2><p>표지: {draft.cover}</p><p className="whitespace-pre-wrap">{draft.body}</p><p className="whitespace-pre-wrap">{draft.meaningKo}</p><p>{draft.tags.join(' · ')}</p><p className="text-sm text-muted">보관함에서 꺼내면 계속 수정할 수 있습니다.</p></section>:<WritingEditor key={`${id}:${sp.restored??''}`} entries={[]} draft={draft}/>}
 <h2 className="mt-6 font-semibold">이전 저장본</h2><LibraryPagination label="이전 버전 페이지" path={`/app/write/history/${id}`} parameter="versions" {...versionPaging}/>
 {versions.map(version=><details key={version.revision} className="my-2 min-w-0 break-words rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer py-2">버전 {version.revision} · {fmtDate(version.created_at.toISOString(),true)}{version.restored_from?` · 버전 ${version.restored_from}에서 복원`:''}</summary><h3>{version.snapshot.title}</h3><p>표지: {version.snapshot.cover}</p><p className="whitespace-pre-wrap">{version.snapshot.body}</p><p className="whitespace-pre-wrap">{version.snapshot.meaningKo}</p><p>{version.snapshot.tags.join(' · ')}</p>{version.revision!==draft.revision&&<RestoreWriting id={id} revision={draft.revision} sourceRevision={version.revision} disabled={Boolean(draft.archivedAt)}/>}</details>)}
 </>;
}
