import { CHECK_DISCLAIMER, formatShot, fieldText, sectionsOf, type ReviewDetail } from '@xhs/core';
import { FindingItem } from './findings';
import { Badge, Card, Notice } from './ui';
import { fmtDate } from './labels';
import { SUBMISSION_STATUS } from './plan-labels';

/** Read-only view of a submitted immutable version, its check and feedback. Shared by student and reviewer. */
export function SubmissionView({ s }: { s: ReviewDetail }) {
  const c = s.version.content;
  const sections = sectionsOf(c);
  const [label, tone] = SUBMISSION_STATUS[s.status] ?? [s.status, 'neutral' as const];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={tone}>{label}</Badge><span>버전 v{s.version.number}</span><span className="text-muted">· {s.cohortName} · 제출 {fmtDate(s.submittedAt, true)}</span>
            {s.author && <span className="text-muted">· {s.author}</span>}
          </div>
          <p className="mt-2 text-xs text-muted">제출된 버전은 바뀌지 않습니다. 학생이 수정하면 새 버전으로 다시 제출해야 합니다.</p>
        </Card>
        <Card>
          <h2 className="zh text-lg font-semibold" lang="zh-CN">{c.title || '(제목 없음)'}</h2>
          {c.cover && <p className="zh mt-1 text-sm text-muted">표지: {c.cover}</p>}
          <p className="zh mt-3 whitespace-pre-wrap text-sm" lang="zh-CN">{c.body}</p>
          {c.tags.length > 0 && <p className="zh mt-2 text-sm text-info">{c.tags.map((t) => `#${t}`).join(' ')}</p>}
          {c.meaningKo && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">한국어 의미</summary><p className="mt-1 whitespace-pre-wrap">{c.meaningKo}</p></details>}
          {c.shots.length > 0 && <div className="mt-3 text-sm"><p className="font-medium">촬영표</p><ol className="space-y-2">{c.shots.map((x, i) => <li key={i} className="whitespace-pre-wrap">{formatShot(x, i)}</li>)}</ol></div>}
        </Card>
        {s.attachments.length > 0 && (
          <Card>
            <h2 className="font-semibold">첨부 이미지</h2>
            <ul className="mt-2 grid grid-cols-3 gap-2">{s.attachments.map((a) => <li key={a.id}><a href={`/api/v1/assets/${a.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/v1/assets/${a.id}`} alt={a.name} className="aspect-square w-full rounded-lg object-cover" /></a></li>)}</ul>
          </Card>
        )}
        <Card>
          <h2 className="font-semibold">사실 입력</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div><dt className="inline text-muted">대상: </dt><dd className="zh inline">{s.version.facts.subject || '-'}</dd></div>
            <div><dt className="text-muted">확인된 사실</dt><dd><ul className="zh list-disc pl-5">{s.version.facts.confirmedFacts.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
            <div><dt className="inline text-muted">광고·협찬: </dt><dd className="inline">{({ yes: '예', no: '아니오', unknown: '미확인' } as Record<string, string>)[s.version.facts.sponsorship]}</dd></div>
          </dl>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <h2 className="font-semibold">함께 제출된 점검 결과</h2>
          <p className="mt-1 text-xs text-muted">{s.check.status === 'completed' ? '점검 완료' : '부분 점검(AI 문맥 미완료)'}{s.acknowledgedIncompleteCheck && ' · 학생이 누락 범위 확인함'}</p>
          {s.check.findings.length === 0 ? <div className="mt-2"><Notice tone="ok">{CHECK_DISCLAIMER}</Notice></div> : (
            <ul className="mt-2 space-y-2">{s.check.findings.map((f, i) => <FindingItem key={i} f={f} text={f.fieldKey === 'document' ? null : fieldText(sections, f.fieldKey)} />)}</ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">피드백</h2>
          {s.feedback.length === 0 ? <p className="mt-2 text-sm text-muted">아직 피드백이 없습니다.</p> : (
            <ul className="mt-2 space-y-2">
              {s.feedback.map((f) => (
                <li key={f.id} className="rounded-xl bg-bg p-3 text-sm">
                  <p className="text-xs text-muted">{f.reviewer} · {fmtDate(f.createdAt, true)} · {({ comment: '코멘트', changes_requested: '수정 요청', feedback_complete: '피드백 완료' } as Record<string, string>)[f.status]}</p>
                  <p className="mt-1 whitespace-pre-wrap">{f.content}</p>
                  {f.checklist.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{f.checklist.map((x) => <li key={x}>{x}</li>)}</ul>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">“피드백 완료”는 게시 허가나 법적 합격을 뜻하지 않습니다.</p>
        </Card>
      </div>
    </div>
  );
}
