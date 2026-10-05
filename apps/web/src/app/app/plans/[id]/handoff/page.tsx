import Link from 'next/link';
import { withPageCtx } from '@/server/ctx';
import { loadHandoff } from '@/server/handoff';
import { CopyButton } from '@/components/copy-button';
import { btn, Card, DemoBadge, Notice, PageHeader } from '@/components/ui';

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
      <p className="mt-6 text-sm text-muted">발행한 뒤에는 성과 기록에서 게시물을 등록하세요(다음 단계에서 제공).</p>
    </>
  );
}
