import type { NoteCard as Note } from '@xhs/core';
import { safeExternalHref } from '@xhs/security';
import { toggleCompare, toggleSaveNote, useAsReference } from '@/app/app/discover/actions';
import { fmtDate, formatLabel, topicLabel } from './labels';
import { Metric, formatMetric } from './metric';
import { Badge, DemoBadge, Thumb, btn } from './ui';

export function NoteCard({ note, back, inCompare, reasons, cons }: { note: Note; back: string; inCompare?: boolean; reasons?: string[]; cons?: string[] }) {
  const href = safeExternalHref(note.canonicalUrl);
  const demoLink = note.canonicalUrl.includes('.invalid');
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-3">
      <Thumb seed={note.platformNoteId} type={note.noteType} />
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <DemoBadge mode={note.dataMode} />
        {note.topics.map((t) => <Badge key={t} tone="accent">{topicLabel(t)}</Badge>)}
        {note.formats.map((f) => <Badge key={f} tone="info">{formatLabel(f)}</Badge>)}
      </div>
      <h3 className="zh mt-2 line-clamp-2 font-semibold" lang="zh-CN">{note.title ?? '제목 없음'}</h3>
      {note.bodyExcerpt && <p className="zh mt-1 line-clamp-2 text-sm text-muted" lang="zh-CN">{note.bodyExcerpt}</p>}
      <p className="mt-2 text-xs text-muted">
        {note.authorName ?? '작성자 미확인'} · 팔로워 {formatMetric(note.authorFollowers).text}
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        <Metric label="좋아요" value={note.metrics.likes} />
        <Metric label="저장" value={note.metrics.saves} />
        <Metric label="댓글" value={note.metrics.comments} />
      </dl>
      <p className="mt-2 text-[11px] text-muted">게시 {fmtDate(note.publishedAt)} · 관찰 {fmtDate(note.observedAt, true)} · 조회수 제공 안 됨</p>
      {reasons && reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {reasons.map((r) => <li key={r} className="text-ok">✓ {r}</li>)}
          {cons?.map((c) => <li key={c} className="text-warn">! {c}</li>)}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        <form action={toggleSaveNote}><input type="hidden" name="noteId" value={note.id} /><input type="hidden" name="back" value={back} />
          <button className={btn.small} aria-pressed={note.saved}>{note.saved ? '★ 저장됨' : '☆ 저장'}</button></form>
        <form action={toggleCompare}><input type="hidden" name="noteId" value={note.id} /><input type="hidden" name="back" value={back} />
          <button className={btn.small} aria-pressed={!!inCompare}>{inCompare ? '비교에서 빼기' : '비교 추가'}</button></form>
        <form action={useAsReference}><input type="hidden" name="noteId" value={note.id} /><input type="hidden" name="back" value={back} />
          <button className={btn.small}>레퍼런스로 가져오기</button></form>
        {href && (demoLink
          ? <span className={`${btn.ghost} cursor-not-allowed`} title="데모 노트는 실제 원문이 없습니다">원문(데모)</span>
          : <a href={href} target="_blank" rel="noopener noreferrer" className={btn.ghost}>원문 ↗</a>)}
      </div>
    </article>
  );
}
