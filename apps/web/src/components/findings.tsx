import type { Finding } from '@xhs/core';
import { Badge } from './ui';
import { FIELD_LABEL, FINDING_LABEL, SEVERITY } from './plan-labels';

/** Shows the flagged span in context; unanchored findings are listed without highlighting (spec F09). */
export function FindingItem({ f, text, action }: { f: Finding; text: string | null; action?: React.ReactNode }) {
  const [sevLabel, sevTone] = SEVERITY[f.severity] ?? ['?', 'neutral'];
  const ctx = f.anchored && text !== null && f.start !== null && f.end !== null && text.slice(f.start, f.end) === f.originalSpan
    ? { pre: text.slice(Math.max(0, f.start - 12), f.start), hit: text.slice(f.start, f.end), post: text.slice(f.end, f.end + 12) }
    : null;
  return (
    <li className="rounded-xl border border-line bg-bg p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={sevTone}>{sevLabel}</Badge>
        <span className="font-medium">{FINDING_LABEL[f.type] ?? f.type}</span>
        <span className="text-xs text-muted">· {FIELD_LABEL[f.fieldKey] ?? f.fieldKey}</span>
        {f.layer === 'contextual' && <Badge tone="info">AI 의견(데모)</Badge>}
        {f.requiresHumanReview && <Badge tone="warn">사람 검토 필요</Badge>}
        {f.reviewOverdue && <Badge tone="warn">규칙 검토 기한 지남</Badge>}
      </div>
      {ctx && <p className="zh mt-2 rounded-lg bg-surface px-2 py-1" lang="zh-CN">…{ctx.pre}<mark className="rounded bg-accent-soft px-0.5 text-accent">{ctx.hit}</mark>{ctx.post}…</p>}
      <p className="mt-1">{f.rationaleKo}</p>
      {f.suggestionZh && <p className="mt-1 text-xs"><span className="text-muted">수정 제안:</span> <span className="zh">{f.suggestionZh}</span></p>}
      <p className="mt-1 text-[11px] text-muted">근거: {f.sourceClass === 'builtin' ? '기본 탐지기' : f.sourceClass === 'ai_opinion' ? 'AI 문맥 의견' : `규칙 ${f.ruleKey} (${f.sourceClass})`} · 확신도 {f.confidence}</p>
      {action}
    </li>
  );
}
