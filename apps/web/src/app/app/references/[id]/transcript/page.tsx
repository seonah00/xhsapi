import Link from 'next/link';
import { analyzeReference, getQuote, getReference, getTranscript, pendingJobFor } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { confirmTranscript, quoteTranscript, removeTranscript, saveExpressionFromTranscript } from '../actions';
import { JobStatus, TranscriptStatus } from '@/components/job-status';
import { ReportButton } from '@/components/report-button';
import { QuoteConfirm } from '@/components/quote-confirm';
import { Badge, btn, Card, DemoBadge, Empty, ErrorNotice, input, Notice, PageHeader } from '@/components/ui';
import { FAIL_LABEL, TRANSCRIPT_STATUS_LABEL, fmtDate } from '@/components/labels';

export const metadata = { title: '음성 문안' };

function mmss(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default async function TranscriptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await withPageCtx(async (ctx) => ({
    ref: await getReference(ctx, id),
    t: await getTranscript(ctx, id),
    pending: sp.job ?? (await pendingJobFor(ctx, 'transcript_submit', id)),
    quote: sp.confirm && sp.quote ? await getQuote(ctx, sp.quote) : null,
  }));
  const { ref, t } = d;
  const active = t && ['queued', 'submitted', 'processing'].includes(t.status);
  const structure = t?.status === 'succeeded'
    ? analyzeReference({ title: null, body: null, tags: [], userText: null, userMemo: null, noteType: 'video', transcript: t.segments.map((s) => ({ seq: s.seq, startMs: s.startMs, endMs: s.endMs, text: s.text ?? s.excerpt ?? '' })) })
    : null;
  return (
    <>
      <PageHeader title="음성 문안 추출" description={<span className="zh">{ref.note?.title ?? ref.title}</span>}
        actions={<Link href={`/app/references/${id}`} className={btn.secondary}>레퍼런스로</Link>} />
      <ErrorNotice message={sp.error} />
      {sp.savedExpr && <div className="mb-3"><Notice tone="ok">내 표현장에 저장했습니다(미검수).</Notice></div>}
      {sp.deleted && <div className="mb-3"><Notice tone="ok">추출 결과를 삭제했습니다.</Notice></div>}
      <div className="mb-4"><Notice tone="warn">음성만 받아쓴 결과입니다. 화면 자막·표지 문구·편집·장면은 포함하지 않습니다. ASR 자동 받아쓰기라 오인식이 있을 수 있습니다.</Notice></div>

      {d.quote ? (
        <QuoteConfirm quote={d.quote} title="음성 문안 추출 확인" action={confirmTranscript} hidden={{ id }} cancelHref={`/app/references/${id}/transcript`}
          scopeLines={['대상: 이 영상 노트 1건', '결과: 시간대별 문장, 구조 분석, 표현 후보 발췌', '개인정보(전화번호·이메일)는 저장 전에 가립니다']} />
      ) : !d.pending && (!t || (!active && t.status !== 'succeeded')) ? (
        <Card>
          <p className="text-sm">이 영상의 말소리를 받아써 도입부·정보 순서·마무리와 실제 구어 표현을 확인합니다.</p>
          <form action={quoteTranscript} className="mt-3"><input type="hidden" name="id" value={id} /><button className={btn.primary}>{t ? '다시 추출 요청' : '추출 요청'}</button></form>
        </Card>
      ) : null}

      {t && active ? <div className="mt-4"><TranscriptStatus referenceId={id} initial={t.status} /></div>
        : d.pending && !t && <div className="mt-4"><JobStatus jobId={d.pending} label="추출 작업 시작" /></div>}

      {t && (
        <section className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <DemoBadge mode={t.dataMode} />
            <Badge tone={t.status === 'succeeded' ? 'ok' : t.status === 'failed' ? 'accent' : 'info'}>{TRANSCRIPT_STATUS_LABEL[t.status] ?? t.status}</Badge>
            {t.failCode && <span className="text-warn">{FAIL_LABEL[t.failCode] ?? t.failCode}</span>}
            <span className="text-xs text-muted">{fmtDate(t.updatedAt, true)}</span>
            {!t.textStored && t.status === 'succeeded' && <Badge tone="warn">전문 미보관(권한 범위) · 발췌만 표시</Badge>}
          </div>
          {t.status === 'no_speech' && <Empty title="말소리를 찾지 못했습니다">음악만 있거나 말이 없는 영상일 수 있습니다. 분석 결과를 만들지 않았습니다.</Empty>}
          {structure && (
            <Card>
              <h2 className="font-semibold">말하기 구조 (관찰)</h2>
              <ul className="mt-2 space-y-1 text-sm">{structure.observations.map((o, i) => <li key={i}>• {o.textKo}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">{structure.inferences[0]?.textKo}</p>
            </Card>
          )}
          {t.segments.length > 0 && (
            <Card>
              <h2 className="font-semibold">시간대별 문장</h2>
              <p className="text-xs text-muted">학습용입니다. 문안을 그대로 복제하지 말고 구조와 표현을 참고하세요.</p>
              <ol className="mt-3 space-y-2">
                {t.segments.map((s) => (
                  <li key={s.seq} className="rounded-xl bg-bg p-3">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 font-mono text-xs text-muted">{mmss(s.startMs)}</span>
                      <p className="zh text-sm" lang="zh-CN">{s.text ?? s.excerpt}{s.masked && <Badge tone="warn">개인정보 가림</Badge>}</p>
                    </div>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted">표현장에 저장</summary>
                      <form action={saveExpressionFromTranscript} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={id} />
                        <label className="sr-only" htmlFor={`e${s.seq}`}>표현</label>
                        <input id={`e${s.seq}`} name="expression" required maxLength={60} defaultValue={(s.excerpt ?? '').slice(0, 20)} className={`${input} zh max-w-[14rem] py-1.5`} />
                        <label className="sr-only" htmlFor={`m${s.seq}`}>뜻</label>
                        <input id={`m${s.seq}`} name="meaning" maxLength={100} placeholder="한국어 뜻(선택)" className={`${input} max-w-[14rem] py-1.5`} />
                        <button className={btn.small}>저장</button>
                      </form>
                    </details>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {t.status === 'succeeded' && <ReportButton targetType="transcript" targetId={t.runId} reasons={['incorrect', 'other']} label="추출 오류 신고" />}
          {!active && (
            <form action={removeTranscript}><input type="hidden" name="id" value={id} /><button className={btn.ghost}>추출 결과 삭제</button></form>
          )}
        </section>
      )}
    </>
  );
}
