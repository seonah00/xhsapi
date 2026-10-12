import Link from 'next/link';
import { AppError } from '@xhs/domain';
import { prepareReferenceAi, getLatestAnalysis, getQuote, getReference, getTranscript, listCollections, pendingJobFor, referenceAssets } from '@xhs/core';
import { Uploader } from '@/components/uploader';
import { withPageCtx } from '@/server/ctx';
import { safeExternalHref } from '@xhs/security';
import { confirmReferenceInfo, quoteReferenceInfo, confirmAnalysis, quoteAnalysis, saveMeta, setTrashed } from './actions';
import { ReportButton } from '@/components/report-button';
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
    let readinessError:string|null=null;
    try { await prepareReferenceAi(ctx,id); } catch (error) { if(!(error instanceof AppError)) throw error; readinessError=error.code==='VALIDATION_FAILED' ? error.message : '분석할 자료가 없습니다. 제목·본문·태그 또는 메모를 입력하고 저장해 주세요. 링크와 표지만으로는 텍스트를 분석할 수 없습니다.'; }
    return {
      ref, readinessError,
      infoPending: sp.infoJob ?? await pendingJobFor(ctx,'note_enrichment',id),
      infoQuote: ctx.role==='org_admin' && sp.confirm==='info' && sp.quote ? await getQuote(ctx,sp.quote) : null,
      collections: await listCollections(ctx),
      images: await referenceAssets(ctx, id),
      mode: ctx.mode,
      canManage: ctx.role === 'org_admin',
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
        actions={<><Link className={btn.primary} href={`/app/plans/new?ref=${ref.id}`}>이 자료로 기획</Link><Link className={btn.secondary} href="/app/references">목록</Link></>} />
      <ErrorNotice message={sp.error} />
      {ref.deletedAt && <div className="mb-4"><Notice tone="warn">휴지통에 있는 레퍼런스입니다.</Notice></div>}
      {sp.saved && <div className="mb-4"><Notice tone="ok">저장했습니다.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="space-y-4">
          {ref.note ? <NoteCard canManage={d.canManage} note={ref.note} back={`/app/references/${id}`} /> : (
            <Card>
              {url && <p className="break-all text-sm"><a href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{url}</a></p>}
              {ref.userText && <p className="zh mt-2 whitespace-pre-wrap text-sm" lang="zh-CN">{ref.userText}</p>}
            </Card>
          )}
          <Card>
            <h2 className="font-semibold">첨부 이미지 <span className="text-xs font-normal text-muted">(비공개, 분석은 이후 단계)</span></h2>
            {d.images.length > 0 && (
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {d.images.map((a) => <li key={a.id}><a href={`/api/v1/assets/${a.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/v1/assets/${a.id}`} alt={a.originalName ?? '첨부 이미지'} className="aspect-square w-full rounded-lg object-cover" /></a></li>)}
              </ul>
            )}
            {!ref.deletedAt && <div className="mt-2"><Uploader purpose="reference_image" referenceId={ref.id} label="이미지 추가" /></div>}
          </Card>
          {d.canManage && ref.sourceType==='manual_url' && !ref.deletedAt && <Card>
            <h2 className="font-semibold">게시물 정보 가져오기</h2>
            <p className="mt-1 text-sm text-muted">관리자용: 저장한 링크에서 제목·본문 발췌·태그를 가져옵니다. 링크 접근이 제한되면 본문을 직접 입력해 주세요.</p>
            {!d.infoQuote && <form action={quoteReferenceInfo} className="mt-2"><input type="hidden" name="id" value={ref.id} /><button className={btn.secondary}>게시물 정보 가져오기</button></form>}
            {d.infoQuote && <QuoteConfirm quote={d.infoQuote} title="게시물 조회 확인" action={confirmReferenceInfo} hidden={{id:ref.id}} cancelHref={`/app/references/${id}`} scopeLines={['저장한 샤오홍슈 링크 1건을 Apify로 조회합니다.','제목·본문 발췌·태그·표지 주소만 사용합니다. 영상 다운로드와 AI 분석은 실행하지 않습니다.']} />}
            {d.infoPending && <JobStatus jobId={d.infoPending} label="게시물 정보 조회" />}
          </Card>}
          <Card>
            <h2 className="font-semibold">내 메모·정리</h2>
            <form action={saveMeta} className="mt-3 space-y-3">
              <input type="hidden" name="id" value={ref.id} /><input type="hidden" name="revision" value={ref.revision} />
              <div><label htmlFor="title" className={label}>제목</label><input id="title" name="title" defaultValue={ref.title ?? ''} maxLength={200} className={input} /></div>
              <div><label htmlFor="userText" className={label}>게시물 본문 (직접 입력)</label><textarea id="userText" name="userText" rows={6} defaultValue={ref.userText ?? ''} maxLength={20000} className={input} /><p className="text-xs text-muted">원문을 열 수 있다면 본문을 복사해 저장하세요. 입력한 텍스트가 분석에 사용됩니다.</p></div>
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
              {!ref.deletedAt && !d.quote && <form action={quoteAnalysis}><input type="hidden" name="id" value={ref.id} /><button className={btn.secondary} disabled={!!d.readinessError}>{d.analysis ? '다시 분석' : '분석하기'}</button></form>}
            </div>
            {d.readinessError && <div className="mt-3"><Notice tone="warn">{d.readinessError}</Notice></div>}
            {!d.readinessError && <p className="mt-2 text-sm text-muted">저장된 텍스트로 분석할 수 있습니다. 표지가 표시되지 않아도 분석에는 영향을 주지 않습니다.</p>}
            {d.mode === 'live' && <p className="mt-2 text-sm text-muted">제목·본문·태그를 바탕으로 주제, 예상 독자, 관심 유도 문구, 본문 구성, 표현, 태그, 행동 유도, 적용 방법을 자세히 분석합니다. 영상 업로드는 필요하지 않습니다.</p>}
            <p className="mb-3 mt-1 text-xs text-muted">본문은 수집된 발췌 범위만 분석합니다. 실제 문구와 새 문구 제안을 구별하며 촬영·편집·영상 자막은 확인할 수 없습니다.</p>
            {d.quote && (
              <div className="mb-3">
                <QuoteConfirm quote={d.quote} title="분석 실행 확인" action={confirmAnalysis} hidden={{ id: ref.id }} cancelHref={`/app/references/${id}`}
                  scopeLines={[d.mode === 'mock' ? '대상: 이 레퍼런스 1건 (제목·본문·태그·내 메모·음성 문안이 있으면 포함)' : '대상: 이 레퍼런스 1건 (제목·본문 발췌·태그·직접 입력한 텍스트·메모)', d.mode === 'mock' ? '데모 모드: 규칙 기반 분석, 외부 AI 호출 없음' : `${d.quote.provider==='gemini' ? 'Google Gemini' : 'OpenAI'} 텍스트 분석: 영상·이미지·음성 문안은 전송하지 않습니다.`]} />
              </div>
            )}
            {d.pending && <div className="mb-3"><JobStatus jobId={d.pending} label="분석 작업" /></div>}
            {d.analysis ? <><AnalysisView a={d.analysis} /><ReportButton targetType="analysis" targetId={d.analysis.id} reasons={['incorrect', 'other']} label="분석 오류 신고" /></> : !d.pending && <p className="text-sm text-muted">아직 분석하지 않았습니다.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
