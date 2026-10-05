import Link from 'next/link';
import { getLatestAnalysis, getQuote, getReference, getTranscript, listCollections, pendingJobFor } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { safeExternalHref } from '@xhs/security';
import { confirmAnalysis, quoteAnalysis, saveMeta, setTrashed } from './actions';
import { AnalysisView } from '@/components/analysis-view';
import { JobStatus } from '@/components/job-status';
import { NoteCard } from '@/components/note-card';
import { QuoteConfirm } from '@/components/quote-confirm';
import { Badge, btn, Card, ErrorNotice, input, label, Notice, PageHeader } from '@/components/ui';
import { TRANSCRIPT_STATUS_LABEL, fmtDate } from '@/components/labels';

export const metadata = { title: '레퍼런스 상세' };

export default async function ReferenceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await withPageCtx(async (ctx) => {
    const ref = await getReference(ctx, id, { includeDeleted: true });
    return {
      ref,
      collections: await listCollections(ctx),
      analysis: await getLatestAnalysis(ctx, id),
      transcript: await getTranscript(ctx, id),
      pending: sp.job ?? (await pendingJobFor(ctx, 'reference_analysis', id)),
      quote: sp.confirm === 'analysis' && sp.quote ? await getQuote(ctx, sp.quote) : null,
    };
  });
  const { ref } = d;
  const url = ref.manualUrl ? safeExternalHref(ref.manualUrl) : null;
  return (
    <>
      <PageHeader title={ref.title ?? ref.note?.title ?? '레퍼런스'} description={<>추가 {fmtDate(ref.createdAt, true)} · 비공개 · 권리: {ref.licenseAssertion === 'reference_only' ? '참고용' : ref.licenseAssertion === 'own_content' ? '내 콘텐츠' : '사용 허락'}</>}
        actions={<Link className={btn.secondary} href="/app/references">목록</Link>} />
      <ErrorNotice message={sp.error} />
      {ref.deletedAt && <div className="mb-4"><Notice tone="warn">휴지통에 있는 레퍼런스입니다.</Notice></div>}
      {sp.saved && <div className="mb-4"><Notice tone="ok">저장했습니다.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="space-y-4">
          {ref.note ? <NoteCard note={ref.note} back={`/app/references/${id}`} /> : (
            <Card>
              {url && <p className="break-all text-sm"><a href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{url}</a></p>}
              {ref.userText && <p className="zh mt-2 whitespace-pre-wrap text-sm" lang="zh-CN">{ref.userText}</p>}
            </Card>
          )}
          <Card>
            <h2 className="font-semibold">내 메모·정리</h2>
            <form action={saveMeta} className="mt-3 space-y-3">
              <input type="hidden" name="id" value={ref.id} /><input type="hidden" name="revision" value={ref.revision} />
              <div><label htmlFor="title" className={label}>제목</label><input id="title" name="title" defaultValue={ref.title ?? ''} maxLength={200} className={input} /></div>
              <div><label htmlFor="memo" className={label}>메모</label><textarea id="memo" name="memo" rows={4} defaultValue={ref.userMemo ?? ''} className={input} /></div>
              <div><label htmlFor="tags" className={label}>태그 (쉼표 구분)</label><input id="tags" name="tags" defaultValue={ref.tags.join(', ')} className={input} /></div>
              <div><label htmlFor="col" className={label}>컬렉션</label>
                <select id="col" name="collectionId" defaultValue={ref.collectionId ?? ''} className={input}><option value="">없음</option>{d.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="favorite" defaultChecked={ref.favorite} /> 즐겨찾기</label>
              <button className={btn.primary} disabled={!!ref.deletedAt}>저장</button>
            </form>
            <form action={setTrashed} className="mt-3">
              <input type="hidden" name="id" value={ref.id} /><input type="hidden" name="trashed" value={ref.deletedAt ? '0' : '1'} />
              <button className={btn.ghost}>{ref.deletedAt ? '휴지통에서 복원' : '휴지통으로 이동'}</button>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          {ref.note?.noteType === 'video' && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">음성 문안 추출 <Badge tone="info">F15 · P1 미리보기</Badge></h2>
                  <p className="text-sm text-muted">영상에서 말한 내용을 받아써 말하기 구조와 구어 표현을 봅니다.</p>
                </div>
                <Link href={`/app/references/${id}/transcript`} className={btn.secondary}>
                  {d.transcript ? `결과 보기 (${TRANSCRIPT_STATUS_LABEL[d.transcript.status] ?? d.transcript.status})` : '추출하러 가기'}
                </Link>
              </div>
            </Card>
          )}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">레퍼런스 분석</h2>
              {!ref.deletedAt && !d.quote && <form action={quoteAnalysis}><input type="hidden" name="id" value={ref.id} /><button className={btn.secondary}>{d.analysis ? '다시 분석' : '분석하기'}</button></form>}
            </div>
            <p className="mb-3 mt-1 text-xs text-muted">관찰 사실과 해석·제안을 구분합니다. 성공 원인을 확정하지 않습니다.</p>
            {d.quote && (
              <div className="mb-3">
                <QuoteConfirm quote={d.quote} title="분석 실행 확인" action={confirmAnalysis} hidden={{ id: ref.id }} cancelHref={`/app/references/${id}`}
                  scopeLines={['대상: 이 레퍼런스 1건 (제목·본문·태그·내 메모·음성 문안이 있으면 포함)', '데모 모드: 규칙 기반 분석, 외부 AI 호출 없음']} />
              </div>
            )}
            {d.pending && <div className="mb-3"><JobStatus jobId={d.pending} label="분석 작업" /></div>}
            {d.analysis ? <AnalysisView a={d.analysis} /> : !d.pending && <p className="text-sm text-muted">아직 분석하지 않았습니다.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
