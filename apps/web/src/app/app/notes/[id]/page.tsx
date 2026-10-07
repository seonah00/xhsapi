import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getNotes } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { CoverThumb } from '@/components/cover-thumb';
import { Metric } from '@/components/metric';
import { PageHeader, Card, Thumb, btn } from '@/components/ui';

export const metadata = { title: '게시물 상세' };
export default async function NoteDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!z.string().uuid().safeParse(id).success) notFound();
  const {note,canManage,mode}=await withPageCtx(async ctx=>({note:(await getNotes(ctx,[id]))[0],canManage:ctx.role==='org_admin',mode:ctx.mode}));
  if(!note || note.dataMode!==mode) notFound();

  return <>
    <PageHeader title={note.title ?? '게시물 상세'} description="수집된 게시물 정보입니다. 전체 내용은 샤오홍슈에서 확인하세요."
      actions={<Link href="/app/discover" className={btn.secondary}>탐색으로</Link>}/>
    <Card>
      {note.coverUrl ? <CoverThumb src={note.coverUrl} alternateSrc={note.fallbackCoverUrl} alt={note.title ?? '게시물 표지'} fallback={<Thumb seed={note.platformNoteId} type={note.noteType}/>}/> : <Thumb seed={note.platformNoteId} type={note.noteType}/>}
      <p className="mt-3 text-sm text-muted">{note.authorName ?? '작성자 미확인'}</p>
      {note.bodyExcerpt && <p lang="zh-CN" className="zh mt-3 whitespace-pre-wrap">{note.bodyExcerpt}</p>}
      <dl className="my-4 grid grid-cols-3 gap-2"><Metric label="좋아요" value={note.metrics.likes}/><Metric label="저장" value={note.metrics.saves}/><Metric label="댓글" value={note.metrics.comments}/></dl>
      <div className="flex flex-wrap gap-2">
        {note.hasOriginalLink && <a href={`/app/notes/${id}/original`} target="_blank" rel="noopener noreferrer" className={btn.secondary}>샤오홍슈 원문 ↗</a>}
        {note.title && !note.canonicalUrl.includes('.invalid') && <a href={`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(note.title.slice(0,60))}`} target="_blank" rel="noopener noreferrer" className={btn.primary}>제목으로 찾기 ↗</a>}
        {canManage && <Link href={`/app/notes/${id}/enrich`} className={btn.secondary}>정보 업데이트</Link>}
      </div>
      <p className="mt-3 text-xs text-muted">유효한 공유 링크가 없거나 원문이 열리지 않으면 ‘제목으로 찾기’를 이용하세요. 원문 접근에 필요한 공유 정보가 제공되지 않은 게시물일 수 있습니다.</p>
    </Card>
  </>;
}
