import Link from 'next/link';
import { CHECK_DISCLAIMER, checksForVersion, fieldText, getCheck, getPlan, getQuote, listGenerations, listMySubmissions, myCohorts, sectionsOf } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { PlanEditor } from '@/components/plan-editor';
import { FindingItem } from '@/components/findings';
import { JobStatus } from '@/components/job-status';
import { QuoteConfirm } from '@/components/quote-confirm';
import { Badge, btn, Card, DemoBadge, ErrorNotice, Notice, PageHeader, selectAuto } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { PLAN_STATUS, SUBMISSION_STATUS } from '@/components/plan-labels';
import * as A from './actions';

export const metadata = { title: '기획' };

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await withPageCtx(async (ctx) => {
    const plan = await getPlan(ctx, id);
    const latestEdit = plan.versions.find((v) => v.kind === 'edit') ?? null;
    const checks = latestEdit ? await checksForVersion(ctx, latestEdit.id) : [];
    const selected = sp.check ? await getCheck(ctx, sp.check).catch(() => null) : checks[0] ?? null;
    return {
      plan, latestEdit, checks, selected,
      generations: await listGenerations(ctx, id),
      cohorts: await myCohorts(ctx),
      submissions: await listMySubmissions(ctx, id),
      quote: sp.quote ? await getQuote(ctx, sp.quote) : null,
    };
  });
  const { plan, latestEdit, selected } = d;
  const p = plan.id;
  const hidden = (extra: Record<string, string> = {}) => Object.entries({ planId: p, ...extra }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const checkVersion = selected?.planVersionId ? plan.versions.find((v) => v.id === selected.planVersionId) : null;
  const checkSections = checkVersion ? sectionsOf(checkVersion.content) : null;
  const checkStaleVsDraft = selected ? selected.contentHash !== plan.draftHash : false;
  const usableChecks = d.checks.filter((c) => c.status === 'completed' || (c.status === 'partial' && c.completeness.rules === 'completed'));
  const proposals = plan.versions.filter((v) => v.kind === 'ai_proposal');

  return (
    <>
      <PageHeader title={plan.title} description={<>{plan.accountName} · 현재 버전 {plan.currentVersion ?? '-'} · 초안 저장 {fmtDate(plan.draftUpdatedAt, true)}</>}
        actions={<>
          <form action={A.changeStatus} className="flex items-center gap-1">{hidden()}
            <label className="sr-only" htmlFor="status">기획 상태</label>
            <select id="status" name="status" defaultValue={plan.status} className={selectAuto}>{Object.entries(PLAN_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className={btn.small}>상태 변경</button>
          </form>
          {latestEdit && <Link href={`/app/plans/${p}/handoff`} className={btn.secondary}>최종본 전달 화면</Link>}
        </>} />
      <ErrorNotice message={sp.error} />
      {sp.applied && <div className="mb-3"><Notice tone="ok">AI 제안을 적용하고 새 버전으로 저장했습니다. 이전 버전은 버전 목록에서 되돌릴 수 있습니다.</Notice></div>}
      {sp.restored && <div className="mb-3"><Notice tone="ok">선택한 버전을 초안으로 되돌렸습니다.</Notice></div>}
      {sp.fixed && <div className="mb-3"><Notice tone="ok">수정 제안을 초안에 적용했습니다. 다시 “버전 저장” 후 재점검하세요.</Notice></div>}
      <p className="mb-4 text-xs text-muted">상태는 직접 바꿉니다. 점검 통과나 강사 피드백으로 자동 변경되지 않습니다.</p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PlanEditor key={plan.revision} planId={p} initial={plan.draft} initialRevision={plan.revision} hasUnversionedChanges={!!latestEdit && latestEdit.checkInputHash !== plan.draftHash} />

        <div className="space-y-4">
          <Card>
            <h2 id="ai" className="font-semibold">AI 기획 제안 <DemoBadge /></h2>
            <p className="mt-1 text-xs text-muted">사실 입력을 바탕으로 별도 제안 버전을 만듭니다. 적용하기 전까지 초안은 바뀌지 않습니다.</p>
            {sp.confirm === 'generation' && d.quote ? (
              <div className="mt-3"><QuoteConfirm quote={d.quote} title="기획 제안 생성 확인" action={A.confirmGeneration} hidden={{ planId: p }} cancelHref={`/app/plans/${p}`}
                scopeLines={['입력: 현재 초안의 사실 입력, 계정 방향, 선택한 레퍼런스 제목·태그', '데모 모드: 템플릿 기반, 외부 AI 호출 없음']} /></div>
            ) : (
              <form action={A.quoteGeneration} className="mt-3">{hidden()}<button className={btn.secondary}>제안 받기</button></form>
            )}
            {sp.job && !sp.check && <div className="mt-3"><JobStatus jobId={sp.job} label="제안 생성" /></div>}
            <ul className="mt-3 space-y-2">
              {d.generations.map((g) => (
                <li key={g.id} className="rounded-xl bg-bg p-3 text-sm">
                  <p className="text-xs text-muted">{fmtDate(g.createdAt, true)}</p>
                  {g.output.kind === 'questions' ? (
                    <><p className="font-medium text-warn">{g.output.reason}</p><ul className="mt-1 list-disc pl-5">{g.output.missingFacts.map((m) => <li key={m}>{m}</li>)}</ul></>
                  ) : (
                    <>
                      <p className="font-medium">제목 후보</p>
                      <ul className="zh list-disc pl-5">{g.output.titleOptions.map((t) => <li key={t}>{t}</li>)}</ul>
                      <p className="mt-1 font-medium">소재 후보</p>
                      <ul className="list-disc pl-5">{g.output.candidates.map((c) => <li key={c.angle}>{c.angle} — {c.difference}</li>)}</ul>
                      {g.output.missingFacts.length > 0 && <p className="mt-1 text-warn">확인 필요: {g.output.missingFacts.join(', ')}</p>}
                      {g.output.notes.map((n) => <p key={n} className="mt-1 text-xs text-muted">{n}</p>)}
                      {g.proposalVersionId && (
                        <form action={A.apply} className="mt-2">{hidden({ versionId: g.proposalVersionId, revision: String(plan.revision) })}
                          <button className={btn.small}>이 제안 적용 (초안 교체)</button></form>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {proposals.length > 0 && <p className="mt-2 text-xs text-muted">제안 버전 {proposals.length}개 보관 중</p>}
          </Card>

          <Card>
            <h2 id="check" className="font-semibold">발행 전 표현 점검</h2>
            <p className="mt-1 text-xs text-muted">저장된 버전을 점검합니다. 규칙 검사는 즉시, AI 문맥 점검은 요청할 때만 실행합니다.</p>
            {latestEdit && (
              <form action={A.check} className="mt-3">{hidden({ versionId: latestEdit.id })}<button className={btn.secondary}>버전 {latestEdit.version} 점검</button></form>
            )}
            {selected && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <Badge tone={selected.status === 'completed' ? 'ok' : selected.status === 'partial' ? 'warn' : 'neutral'}>{selected.status === 'completed' ? '완료' : selected.status === 'partial' ? '부분 완료' : selected.status}</Badge>
                  <span className="text-muted">버전 {checkVersion?.version ?? '-'} · {fmtDate(selected.createdAt, true)}</span>
                  <span className="text-muted">규칙 {selected.completeness.rules === 'completed' ? '완료' : '미완료'} · AI 문맥 {({ not_requested: '요청 안 함', queued: '대기 중', completed: '완료', failed: '완료하지 못함' } as Record<string, string>)[selected.completeness.contextual ?? ''] ?? '-'}</span>
                </div>
                {checkStaleVsDraft && <Notice tone="warn">초안이 이 점검 이후 바뀌었습니다. 이 결과는 최신 문안 기준이 아닙니다.</Notice>}
                {selected.completeness.contextual === 'failed' && <Notice tone="warn">AI 문맥 검사를 완료하지 못했습니다. 아래는 규칙 검사 결과입니다.</Notice>}
                {sp.confirm === 'contextual' && d.quote ? (
                  <QuoteConfirm quote={d.quote} title="AI 문맥 점검 확인" action={A.confirmContextual} hidden={{ planId: p, checkRunId: selected.id }} cancelHref={`/app/plans/${p}?check=${selected.id}`}
                    scopeLines={['대상: 이 점검의 버전 문안', '데모 모드: 휴리스틱 의견, 외부 AI 호출 없음']} />
                ) : selected.completeness.contextual === 'not_requested' && selected.planVersionId && (
                  <form action={A.quoteContextual}>{hidden({ checkRunId: selected.id })}<button className={btn.small}>AI 문맥 점검 요청</button></form>
                )}
                {sp.job && sp.check && <JobStatus jobId={sp.job} label="AI 문맥 점검" />}
                {selected.findings.length === 0 ? <Notice tone="ok">{CHECK_DISCLAIMER}</Notice> : (
                  <ul className="space-y-2">
                    {selected.findings.map((f, i) => (
                      <FindingItem key={i} f={f} text={checkSections && f.fieldKey !== 'document' ? fieldText(checkSections, f.fieldKey) : null}
                        action={f.suggestionZh && f.anchored && !checkStaleVsDraft ? (
                          <form action={A.applyFix} className="mt-2">{hidden({ checkRunId: selected.id, index: String(i) })}<button className={btn.small}>수정 제안 적용</button></form>
                        ) : null} />
                    ))}
                  </ul>
                )}
                {selected.findings.length > 0 && <p className="text-xs text-muted">위험 항목이 남아도 제출·내보내기는 막지 않습니다. 확인하지 않은 항목 수: {selected.findings.filter((f) => f.requiresHumanReview).length}개. 점검은 게시 승인이 아닙니다.</p>}
              </div>
            )}
          </Card>

          <Card>
            <h2 id="submit" className="font-semibold">강사에게 제출</h2>
            {sp.submitted && <div className="mt-2"><Notice tone="ok">제출했습니다. 강사는 이 버전과 점검 결과만 볼 수 있습니다.</Notice></div>}
            {d.cohorts.length === 0 ? <p className="mt-2 text-sm text-muted">배정된 기수가 없습니다.</p> : !latestEdit || usableChecks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">최신 버전을 먼저 점검하세요. 점검 결과가 있어야 제출할 수 있습니다.</p>
            ) : (
              <form action={A.submit} className="mt-3 space-y-2 text-sm">
                {hidden({ versionId: latestEdit.id })}
                <div className="rounded-xl bg-bg p-3">
                  <p className="font-medium">공유되는 것</p>
                  <ul className="list-disc pl-5 text-xs">
                    <li>기획 버전 {latestEdit.version} (제목·본문·태그·자막·촬영표·사실 입력)</li>
                    <li>선택한 점검 결과 1건</li>
                    <li>첨부 없음</li>
                  </ul>
                  <p className="mt-1 text-xs text-muted">다른 버전·비공개 레퍼런스·계정 프로필 전체는 공유되지 않습니다.</p>
                </div>
                <label className="block">기수<select name="cohortId" className={`${selectAuto} ml-2`}>{d.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className="block">점검 결과<select name="checkRunId" className={`${selectAuto} ml-2`}>{usableChecks.map((c) => <option key={c.id} value={c.id}>{fmtDate(c.createdAt, true)} · {c.status === 'completed' ? '완료' : '부분 완료'} · {c.findings.length}건</option>)}</select></label>
                {usableChecks.some((c) => c.status === 'partial') && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="ack" /> 부분 점검이면 AI 문맥 점검이 빠진 것을 확인했습니다</label>}
                <button className={btn.primary}>제출</button>
              </form>
            )}
            {d.submissions.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {d.submissions.map((s) => {
                  const [label, tone] = SUBMISSION_STATUS[s.status] ?? [s.status, 'neutral' as const];
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2">
                      <span><Link href={`/app/submissions/${s.id}`} className="underline">버전 {s.version} · {s.cohortName}</Link> <Badge tone={tone}>{label}</Badge>
                        {s.version !== latestEdit?.version && s.status !== 'withdrawn' && <span className="ml-1 text-xs text-warn">이전 버전 대상</span>}</span>
                      {s.status !== 'withdrawn' && <form action={A.withdraw}>{hidden({ submissionId: s.id })}<button className={btn.ghost}>철회</button></form>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="font-semibold">버전</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {plan.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>v{v.version} {v.kind === 'ai_proposal' ? <Badge tone="info">AI 제안</Badge> : <Badge>편집</Badge>} <span className="text-xs text-muted">{fmtDate(v.createdAt, true)}</span></span>
                  {v.kind === 'edit' && <form action={A.restore}>{hidden({ versionId: v.id, revision: String(plan.revision) })}<button className={btn.ghost}>초안으로 되돌리기</button></form>}
                </li>
              ))}
            </ul>
            <form action={A.archive} className="mt-3">{hidden()}<button className={btn.ghost}>기획 보관(목록에서 숨김)</button></form>
          </Card>
        </div>
      </div>
    </>
  );
}
