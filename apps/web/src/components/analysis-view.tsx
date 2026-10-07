import { REFERENCE_SECTION_LABELS, type EvidenceClaim, type StoredAnalysis } from '@xhs/core';
import { Badge, DemoBadge } from './ui';
import { fmtDate } from './labels';

const EVIDENCE: Record<string,string> = {title:'제목',body:'본문 발췌',tags:'태그',userText:'입력한 본문',userMemo:'내 메모',transcript:'음성 문안'};
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
              근거: {c.evidenceIds.length ? c.evidenceIds.map(id=>EVIDENCE[id] ?? (id.startsWith('seg:')?'음성 문장 '+id.slice(4):'제공 자료')).join(', ') : <span className="text-warn">일반 적용 제안</span>}{c.uncertainty && ` · ${c.uncertainty}`}
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
      {o.sections?.length ? <div className="space-y-4">{o.sections.map(section=>(
        <section key={section.key} aria-labelledby={`analysis-${section.key}`} className="rounded-xl border border-line p-4">
          <h3 id={`analysis-${section.key}`} className="mb-2 font-semibold">{REFERENCE_SECTION_LABELS[section.key]}</h3>
          {section.status==='insufficient' ? <p className="text-sm text-muted">자료 부족 · {section.missingReason}</p> : <>
            <Block title="관찰 사실" tone="ok" items={section.claims.filter(c=>c.kind==='observation')} />
            <Block title="해석·가설" tone="info" items={section.claims.filter(c=>c.kind==='inference')} />
            <Block title="적용 제안" tone="accent" items={section.claims.filter(c=>c.kind==='suggestion')} />
            {section.quotes.map((q,i)=><blockquote key={i} className="mt-3 border-l-2 border-accent pl-3 text-sm">
              <p className="zh break-words" lang="zh-CN">“{q.text}”</p><p className="mt-1">뜻: {q.meaningKo}</p><p className="text-muted">{q.explanationKo}</p><p className="text-xs text-muted">출처: {EVIDENCE[q.field]}</p>
            </blockquote>)}
          </>}
        </section>
      ))}</div> : <>
      <Block title="관찰 사실" tone="ok" items={o.observations} />
      <Block title="해석·가설" tone="info" items={o.inferences} />
      <Block title="내 콘텐츠 적용 제안" tone="accent" items={o.suggestions} />
      </>}
      {(o.limitations.length > 0 || o.missingFacts.length > 0) && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          <p className="font-medium">분석하지 않은 것</p>
          <ul className="list-disc pl-5">{[...o.limitations, ...o.missingFacts].map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
