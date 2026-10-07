import type { EvidenceClaim, StoredAnalysis } from '@xhs/core';
import { Badge, DemoBadge } from './ui';
import { fmtDate } from './labels';

const SCOPE: Record<string, string> = {
  metadata_only: '메타데이터', body_only: '본문 텍스트', cover_and_body: '표지+본문', audio_transcript: '음성 문안', selected_frames: '선택 프레임', full_video: '전체 영상', user_notes_only: '내 메모',
};

function Block({ title, tone, items }: { title: string; tone: 'ok' | 'info' | 'accent'; items: EvidenceClaim[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold"><Badge tone={tone}>{title}</Badge></h3>
      <ul className="space-y-1.5 text-sm">
        {items.map((c, i) => (
          <li key={i} className="rounded-lg bg-bg px-3 py-2">
            {c.textKo}
            <span className="mt-0.5 block text-[11px] text-muted">
              근거: {c.evidenceIds.length ? c.evidenceIds.join(', ') : <span className="text-warn">source_missing</span>}{c.uncertainty && ` · ${c.uncertainty}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisView({ a }: { a: StoredAnalysis }) {
  if (!a.output) return <p className="text-sm text-muted">분석 결과가 없습니다.</p>;
  const o = a.output;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <DemoBadge mode={a.dataMode} />
        <span>분석 범위:</span>{o.analysisScope.map((s) => <Badge key={s} tone="info">{SCOPE[s] ?? s}</Badge>)}
        <span>· {fmtDate(a.createdAt, true)} · {o.generator === 'mock-rules-v1' ? '규칙 기반 데모 분석(AI 아님)' : 'AI 텍스트 분석'}</span>
      </div>
      <Block title="관찰 사실" tone="ok" items={o.observations} />
      <Block title="해석·가설" tone="info" items={o.inferences} />
      <Block title="내 콘텐츠 적용 제안" tone="accent" items={o.suggestions} />
      {(o.limitations.length > 0 || o.missingFacts.length > 0) && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          <p className="font-medium">분석하지 않은 것</p>
          <ul className="list-disc pl-5">{[...o.limitations, ...o.missingFacts].map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
