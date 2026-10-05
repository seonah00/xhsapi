import type { MetricValue } from '@xhs/domain';

const nf = new Intl.NumberFormat('ko-KR');

/** Never shows a missing value as 0, and marks bounds/estimates (spec 0.5, 5.3). */
export function formatMetric(m: MetricValue | null | undefined): { text: string; hint: string | null } {
  if (!m || m.precision === 'unknown') return { text: '미확인', hint: m?.raw != null ? `원문: ${String(m.raw)}` : null };
  switch (m.precision) {
    case 'exact': return { text: nf.format(m.exact ?? 0), hint: null };
    case 'lower_bound': return { text: `${nf.format(m.lowerBound ?? 0)}+`, hint: `하한값(원문 ${String(m.raw)}), 정확한 값 아님` };
    case 'estimated': return { text: `약 ${String(m.raw)}`, hint: `약식 표기, ${nf.format(m.lowerBound ?? 0)}~${nf.format(m.upperBound ?? 0)} 범위` };
    case 'range': return { text: `${nf.format(m.lowerBound ?? 0)}~${nf.format(m.upperBound ?? 0)}`, hint: '범위값' };
  }
}

export function Metric({ label, value }: { label: string; value: MetricValue | null | undefined }) {
  const { text, hint } = formatMetric(value);
  const unknown = !value || value.precision === 'unknown';
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-sm font-medium tabular-nums ${unknown ? 'text-muted' : ''}`} title={hint ?? undefined}>
        {text}
        {hint && <span className="sr-only"> ({hint})</span>}
      </dd>
    </div>
  );
}
