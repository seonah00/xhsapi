'use client';
import { useActionState, useId } from 'react';
import { reportAction, type ReportState } from '@/app/app/report-action';

const REASONS: Record<string, string> = {
  incorrect: '내용이 틀림', false_positive: '잘못된 경고(오탐)', missed_issue: '놓친 문제', rights_issue: '권리 침해', source_removed: '원본 삭제됨', other: '기타',
};

/** Error/rights report (spec 11). Only the result id, a reason and an optional short memo are sent. */
export function ReportButton({ targetType, targetId, findingIndex, reasons, label = '오류 신고' }: {
  targetType: 'analysis' | 'check_finding' | 'library_item' | 'transcript' | 'note'; targetId: string; findingIndex?: number;
  reasons: (keyof typeof REASONS)[]; label?: string;
}) {
  const [state, action, pending] = useActionState<ReportState, FormData>(reportAction, {});
  const id = useId();
  if (state.done) return <p role="status" className="mt-2 text-xs text-ok">신고했습니다. 강사·관리자가 확인합니다.</p>;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted underline">{label}</summary>
      <form action={action} className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-2">
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        {findingIndex !== undefined && <input type="hidden" name="findingIndex" value={findingIndex} />}
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="sr-only">사유</legend>
          {reasons.map((r, i) => <label key={r} className="flex items-center gap-1"><input type="radio" name="reason" value={r} defaultChecked={i === 0} /> {REASONS[r]}</label>)}
        </fieldset>
        <label htmlFor={`${id}-note`} className="sr-only">짧은 메모</label>
        <input id={`${id}-note`} name="note" maxLength={200} placeholder="짧은 메모(선택, 본문을 붙여 넣지 마세요)" className="w-full rounded-lg border border-line bg-surface px-2 py-1" />
        <button disabled={pending} className="rounded-lg border border-line px-2 py-1 font-medium hover:bg-bg disabled:opacity-50">{pending ? '보내는 중…' : '신고 보내기'}</button>
        {state.error && <p role="alert" className="text-warn">{state.error}</p>}
      </form>
    </details>
  );
}
