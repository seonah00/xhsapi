'use client';
import type { CheckState } from './actions';
import { FindingItemClient } from './finding-client';

const DISCLAIMER = '현재 검사 범위에서 위험 표현을 찾지 못했습니다. 게시 승인이나 법적 안전을 보장하지 않습니다.';

export function Results({ state }: { state: CheckState }) {
  const f = state.findings ?? [];
  const s = state.sections!;
  const text = (k: string) => (k === 'tags' ? s.tags.join(' ') : k === 'document' ? null : (s as Record<string, unknown>)[k] as string);
  return (
    <section className="mt-4 space-y-2" aria-labelledby="result" aria-live="polite">
      <h2 id="result" className="font-semibold">결과 · {f.length}건</h2>
      {f.length === 0 ? <p role="status" className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">{DISCLAIMER}</p> : (
        <ul className="space-y-2">{f.map((x, i) => <FindingItemClient key={i} f={x} text={text(x.fieldKey)} />)}</ul>
      )}
      <p className="text-xs text-muted">점검은 규칙과 탐지기의 보조 의견입니다. 게시 승인·법적 안전·노출을 보장하지 않습니다.</p>
    </section>
  );
}
