import Link from 'next/link';
import { withPageCtx } from '@/server/ctx';
import { loadHandoff } from '@/server/handoff';
import { CopyButton } from '@/components/copy-button';
import { btn, Card, DemoBadge, input, Notice, PageHeader } from '@/components/ui';
import { addPublication } from '@/app/app/results/actions';

export const metadata = { title: '최종본 전달' };

export default async function Handoff({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  const { version } = await searchParams;
  const h = await withPageCtx((ctx) => loadHandoff(ctx, id, version));
  const c = h.version.content;
  const block = (title: string, text: string, zh = true) => (
    <Card>
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{title}</h2>{text && <CopyButton text={text} label={`${title} 복사`} />}</div>
      <p className={`mt-2 whitespace-pre-wrap text-sm ${zh ? 'zh' : ''}`}>{text || <span className="text-muted">비어 있음</span>}</p>
    </Card>
  );
  return (
    <>
      <PageHeader title="최종본 전달" description={<>버전 v{h.version.version} · <DemoBadge mode={h.dataMode} /></>}
        actions={<><Link href={`/app/plans/${id}`} className={btn.secondary}>기획으로</Link>
          <a href={`/api/v1/plans/${id}/export?format=md&version=${h.version.id}`} className={btn.secondary}>Markdown 내보내기</a>
          <a href={`/api/v1/plans/${id}/export?format=json&version=${h.version.id}`} className={btn.secondary}>JSON 내보내기</a></>} />
      <div className="mb-4 space-y-2">
        {h.checkState === 'none' && <Notice tone="warn">이 버전은 아직 점검하지 않았습니다. 발행 전에 점검을 권합니다.</Notice>}
        {h.checkState === 'partial' && <Notice tone="warn">부분 점검 상태입니다(AI 문맥 점검 미완료).</Notice>}
        {h.unresolved > 0 && <Notice tone="warn">사람 검토가 필요한 항목 {h.unresolved}개가 남아 있습니다.</Notice>}
        <Notice>복사·내보내기는 외부 게시가 아닙니다. 샤오홍슈 앱에서 직접 발행하세요. 점검 결과는 게시 승인이나 법적 안전을 보장하지 않습니다.</Notice>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {block('제목', c.title)}
        {block('표지 문구', c.cover)}
        <div className="md:col-span-2">{block('본문', c.body)}</div>
        {block('해시태그', c.tags.map((t) => `#${t}`).join(' '))}
        {block('자막', c.subtitles)}
        <div className="md:col-span-2">{block('촬영표', c.shots.map((s, i) => `${i + 1}. ${s.scene}${s.note ? ` — ${s.note}` : ''}`).join('\n'), false)}</div>
        <div className="md:col-span-2">{block('한국어 의미', c.meaningKo, false)}</div>
      </div>
      <Card className="mt-6">
        <h2 className="font-semibold">발행했나요? 발행 기록 등록</h2>
        <form action={addPublication} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="accountId" value={h.accountId} /><input type="hidden" name="planVersionId" value={h.version.id} /><input type="hidden" name="title" value={c.title || h.planTitle} />
          <label>게시물 링크<input name="noteUrl" type="url" className={`${input} mt-1 w-72`} /></label>
          <label>발행일시<input name="publishedAt" type="datetime-local" className={`${input} mt-1`} /></label>
          <button className={btn.primary}>성과 기록에 등록</button>
        </form>
        <p className="mt-2 text-xs text-muted">이 버전(v{h.version.version})과 연결됩니다. 발행은 샤오홍슈 앱에서 직접 하세요.</p>
      </Card>
    </>
  );
}
