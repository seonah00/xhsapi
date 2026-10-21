import { NoteVideo } from '@/components/note-video';
import { AutoSearchStatus } from '@/components/auto-search-status';
import { PendingButton } from '@/components/pending-button';
import { CopyButton } from '@/components/copy-button';
import Link from 'next/link';
import { connectOriginal, refreshOriginal } from './actions';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getNotes, autoSearchStatus, noteVideoStream } from '@xhs/core';
import { withPageCtx, service } from '@/server/ctx';
import { CoverThumb } from '@/components/cover-thumb';
import { Metric } from '@/components/metric';
import { PageHeader, Card, Thumb, btn } from '@/components/ui';

export const metadata = { title: '게시물 상세' };
export default async function NoteDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;connected?:string;refresh?:string;link?:string}>}) {
  const {id}=await params;
  const sp=await searchParams;
  if(!z.string().uuid().safeParse(id).success) notFound();
  const {note,canManage,mode,videoSrc}=await withPageCtx(async ctx=>({note:(await getNotes(ctx,[id]))[0],canManage:ctx.role==='org_admin',mode:ctx.mode,videoSrc:await noteVideoStream(ctx,id)}));
  const refresh=z.string().uuid().safeParse(sp.refresh);
  const status=refresh.success ? await withPageCtx(ctx=>autoSearchStatus(ctx,service,refresh.data)) : null;
  if(!note || note.dataMode!==mode) notFound();

  return <>
    <PageHeader title={note.title ?? '게시물 상세'} description="수집된 게시물 정보입니다. 전체 내용은 샤오홍슈에서 확인하세요."
      actions={<Link href="/app/discover" className={btn.secondary}>탐색으로</Link>}/>
    {sp.link==='unavailable' && <p role="alert" className="mb-3 rounded-xl bg-warn-soft p-3 text-sm text-warn">이 원문 공유 링크는 현재 사용할 수 없습니다. 연결 정보가 없거나 사용할 수 없어 새로 확인해야 합니다.</p>}
    {sp.error && <p role="alert" className="text-warn">{sp.error}</p>}
    {sp.connected && <p role="status">원문 링크를 연결했습니다. 아래 버튼으로 게시물을 여세요.</p>}
    {refresh.success && status && <AutoSearchStatus requestId={refresh.data} original/>}
    <Card>

      {note.coverUrl ? <CoverThumb src={note.coverUrl} alternateSrc={note.fallbackCoverUrl} alt={note.title ?? '게시물 표지'} fallback={<Thumb seed={note.platformNoteId} type={note.noteType}/>}/> : <Thumb seed={note.platformNoteId} type={note.noteType}/>}
      {videoSrc ? <NoteVideo key={videoSrc} src={videoSrc}/> : note.noteType === 'video' && <p id="video" className="my-3 text-sm text-muted">현재 재생 가능한 영상 주소가 수집되지 않았습니다.</p>}
      <p className="mt-3 text-sm text-muted">{note.authorName ?? '작성자 미확인'}</p>
      {note.bodyExcerpt && <p lang="zh-CN" className="zh mt-3 whitespace-pre-wrap">{note.bodyExcerpt}</p>}
      <dl className="my-4 grid grid-cols-3 gap-2"><Metric label="좋아요" value={note.metrics.likes}/><Metric label="저장" value={note.metrics.saves}/><Metric label="댓글" value={note.metrics.comments}/></dl>
      <div id="original-status" className="flex flex-wrap gap-2">
        {note.hasOriginalLink && <a href={`/app/notes/${id}/original`} target="_blank" rel="noopener noreferrer" className={btn.primary}>게시물 원문 보기 ↗</a>}
        {canManage && <Link href={`/app/notes/${id}/enrich`} className={btn.secondary}>정보 업데이트</Link>}
      </div>
      <div className="mt-4 space-y-3 rounded-xl border border-line p-3">
        <h2 className="font-semibold">게시물 링크</h2>
        {note.hasOriginalLink ? <>
          <a href={`/app/notes/${id}/original`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all text-sm underline">원문 연결 주소 열기 ↗</a>
          <div><CopyButton text={`/app/notes/${id}/original`} appRelative label="원문 연결 링크 복사"/></div>
          <p className="text-xs text-muted">원문은 샤오홍슈의 국제 사이트 rednote에서 엽니다. 로그인이 필요하면 원문을 연 같은 사이트에서 로그인해 주세요. 주소는 게시물과 함께 보관하며, 게시물 삭제나 공유 링크 만료 시 열리지 않을 수 있습니다.</p>
          <a href={`/app/notes/${id}/original?site=xiaohongshu`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm underline">중국 사이트에서 열기 ↗</a>
        </> : <p className="text-sm text-muted">제공할 원문 공유 주소가 아직 없습니다. 아래 기본 주소는 접근이 보장되는 공유 링크가 아닙니다.</p>}
        <details className="text-sm">
          <summary className="cursor-pointer py-3">게시물 기본 주소 확인</summary>
          <p className="my-2 break-all">{note.canonicalUrl}</p>
          <CopyButton text={note.canonicalUrl} label="게시물 기본 주소 복사"/>
          <p className="mt-2 text-xs text-muted">이 주소에는 접근용 공유 정보가 없어 샤오홍슈에서 열리지 않을 수 있습니다.</p>
        </details>
      </div>
      {!note.hasOriginalLink && <div className="mt-3 space-y-2">
        <p role="status">현재 보관된 원문 공유 링크가 없습니다. 다시 검색해 동일한 게시물이 발견되면 원문 보기 버튼이 나타납니다.</p>
        {status?.state==='succeeded' && <p>검색은 완료됐지만 이 게시물의 유효한 링크를 찾지 못했습니다. 다른 게시물로 대신 연결하지 않습니다.</p>}
        <form action={refreshOriginal}><input type="hidden" name="noteId" value={id}/><PendingButton disabled={!!status && ['queued','running','waiting_external','unknown_outcome'].includes(status.state)} className={btn.secondary}>원문 링크 다시 찾기</PendingButton></form>
        <p className="text-xs text-muted">관리자가 설정한 검색 범위 안에서 실행합니다. 원문 삭제·검색 제외·샤오홍슈 로그인 제한은 해결되지 않을 수 있습니다.</p>
        {canManage && <p className="text-xs text-muted">Apify 제목 검색을 사용하며 기존 승인 예산·검증 단가·캐시·중복 방지를 적용합니다. 검색 성공이 해당 게시물 복구를 보장하지 않습니다.</p>}
      </div>}
      {note.hasOriginalLink && <p className="mt-3 text-xs text-muted">샤오홍슈에서 로그인이 필요할 수 있습니다. 보관된 주소의 현재 열림 여부는 확인되지 않았습니다. 원문 삭제나 공유 링크 만료 시 열리지 않을 수 있습니다.</p>}
      {canManage && <form action={connectOriginal} className="mt-5 space-y-2">
        <input type="hidden" name="noteId" value={id}/>
        <label className="block">원문 공유 주소<input name="shareUrl" type="url" required maxLength={4000} className="mt-1 block w-full rounded border border-line p-2" placeholder="https://www.xiaohongshu.com/explore/…?xsec_token=…"/></label>
        <p className="text-xs text-muted">샤오홍슈에서 실제로 열리는 이 게시물의 전체 공유 주소를 입력하세요. 게시물을 보관하는 동안 함께 보관하며 검색·계정·단축 주소는 받지 않습니다. 별도 API 비용은 없습니다.</p>
        <button className={btn.secondary}>원문 링크 연결</button>
      </form>}
    </Card>
  </>;
}
