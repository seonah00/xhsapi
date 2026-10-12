import Link from 'next/link';
import { connectOriginal } from './actions';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getNotes } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { CoverThumb } from '@/components/cover-thumb';
import { Metric } from '@/components/metric';
import { PageHeader, Card, Thumb, btn } from '@/components/ui';

export const metadata = { title: '게시물 상세' };
export default async function NoteDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;connected?:string}>}) {
  const {id}=await params;
  const sp=await searchParams;
  if(!z.string().uuid().safeParse(id).success) notFound();
  const {note,canManage,mode}=await withPageCtx(async ctx=>({note:(await getNotes(ctx,[id]))[0],canManage:ctx.role==='org_admin',mode:ctx.mode}));
  if(!note || note.dataMode!==mode) notFound();

  return <>
    <PageHeader title={note.title ?? '게시물 상세'} description="수집된 게시물 정보입니다. 전체 내용은 샤오홍슈에서 확인하세요."
      actions={<Link href="/app/discover" className={btn.secondary}>탐색으로</Link>}/>
    {sp.error && <p role="alert" className="text-warn">{sp.error}</p>}
    {sp.connected && <p role="status">원문 링크를 연결했습니다. 아래 버튼으로 게시물을 여세요.</p>}
    <Card>
      {note.coverUrl ? <CoverThumb src={note.coverUrl} alternateSrc={note.fallbackCoverUrl} alt={note.title ?? '게시물 표지'} fallback={<Thumb seed={note.platformNoteId} type={note.noteType}/>}/> : <Thumb seed={note.platformNoteId} type={note.noteType}/>}
      <p className="mt-3 text-sm text-muted">{note.authorName ?? '작성자 미확인'}</p>
      {note.bodyExcerpt && <p lang="zh-CN" className="zh mt-3 whitespace-pre-wrap">{note.bodyExcerpt}</p>}
      <dl className="my-4 grid grid-cols-3 gap-2"><Metric label="좋아요" value={note.metrics.likes}/><Metric label="저장" value={note.metrics.saves}/><Metric label="댓글" value={note.metrics.comments}/></dl>
      <div className="flex flex-wrap gap-2">
        {note.hasOriginalLink && <a href={`/app/notes/${id}/original`} target="_blank" rel="noopener noreferrer" className={btn.primary}>게시물 원문 보기 ↗</a>}
        {note.title && !note.canonicalUrl.includes('.invalid') && <a href={`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(note.title.slice(0,60))}`} target="_blank" rel="noopener noreferrer" className={btn.secondary}>샤오홍슈에서 제목 검색 ↗</a>}
        {canManage && <Link href={`/app/notes/${id}/enrich`} className={btn.secondary}>정보 업데이트</Link>}
      </div>
      {!note.hasOriginalLink && <p role="status" className="mt-3 text-sm">현재 이 게시물의 유효한 원문 공유 링크가 없습니다. 제목 검색은 검색 결과를 열며 해당 게시물로 바로 연결되지 않습니다. 관리자에게 원문 링크 연결을 요청하세요.</p>}
      {note.hasOriginalLink && <p className="mt-3 text-xs text-muted">샤오홍슈에서 로그인이 필요할 수 있습니다. 원문 삭제나 공유 링크 만료 시 열리지 않을 수 있습니다.</p>}
      {canManage && <form action={connectOriginal} className="mt-5 space-y-2">
        <input type="hidden" name="noteId" value={id}/>
        <label className="block">원문 공유 주소<input name="shareUrl" type="url" required maxLength={4000} className="mt-1 block w-full rounded border border-line p-2" placeholder="https://www.xiaohongshu.com/explore/…?xsec_token=…"/></label>
        <p className="text-xs text-muted">샤오홍슈에서 실제로 열리는 이 게시물의 전체 공유 주소를 입력하세요. 24시간 보관하며 검색·계정·단축 주소는 받지 않습니다. 별도 API 비용은 없습니다.</p>
        <button className={btn.secondary}>원문 링크 연결</button>
      </form>}
    </Card>
  </>;
}
