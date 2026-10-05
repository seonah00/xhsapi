import { z } from 'zod';

export const MetricPrecision = z.enum(['exact', 'lower_bound', 'range', 'estimated', 'unknown']);

export const MetricValue = z.object({
  raw: z.union([z.string(), z.number(), z.null()]),
  exact: z.number().int().nonnegative().nullable(),
  lowerBound: z.number().nonnegative().nullable(),
  upperBound: z.number().nonnegative().nullable(),
  precision: MetricPrecision,
});
export type MetricValue = z.infer<typeof MetricValue>;

const UNIT: Record<string, number> = { '': 1, k: 1_000, K: 1_000, w: 10_000, W: 10_000, '万': 10_000, '千': 1_000, '亿': 100_000_000 };
const NUM = String.raw`(\d+(?:\.\d+)?)\s*([kKwW万千亿]?)`;
const SINGLE = new RegExp(`^${NUM}(\\+)?$`);
const RANGE = new RegExp(`^${NUM}\\s*[-~～至]\\s*${NUM}$`);

function scale(n: string, unit: string): number {
  return Math.round(Number(n) * (UNIT[unit] ?? NaN));
}

const unknown = (raw: MetricValue['raw']): MetricValue => ({ raw, exact: null, lowerBound: null, upperBound: null, precision: 'unknown' });

/**
 * Parses a provider metric without inventing precision (spec 5.3).
 * `4w+` → lower bound 40,000; `1.2万` → estimated (abbreviated, not exact);
 * missing values stay null rather than 0.
 */
export function parseMetricValue(raw: unknown): MetricValue {
  if (raw === null || raw === undefined || raw === '') return unknown(null);
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return unknown(raw);
    return Number.isInteger(raw)
      ? { raw, exact: raw, lowerBound: raw, upperBound: raw, precision: 'exact' }
      : unknown(raw);
  }
  if (typeof raw !== 'string') return unknown(null);
  const text = raw.trim().replace(/,/g, '');

  const single = SINGLE.exec(text);
  if (single) {
    const [, n = '', unit = '', plus] = single;
    const value = scale(n, unit);
    if (!Number.isFinite(value)) return unknown(raw);
    if (plus) return { raw, exact: null, lowerBound: value, upperBound: null, precision: 'lower_bound' };
    if (unit === '' && !n.includes('.')) return { raw, exact: value, lowerBound: value, upperBound: value, precision: 'exact' };
    // Abbreviated display values (1.2万) are rounded by the source: keep the rounding interval, not a point value.
    const decimals = n.split('.')[1]?.length ?? 0;
    const half = ((UNIT[unit] ?? 1) * 10 ** -decimals) / 2;
    return { raw, exact: null, lowerBound: Math.max(0, Math.round(value - half)), upperBound: Math.round(value + half), precision: 'estimated' };
  }

  const range = RANGE.exec(text);
  if (range) {
    const [, a = '', ua = '', b = '', ub = ''] = range;
    const lo = scale(a, ua || ub);
    const hi = scale(b, ub);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
      return { raw, exact: null, lowerBound: lo, upperBound: hi, precision: 'range' };
    }
  }
  return unknown(raw);
}

/** Ratio only when both values are exact and the denominator is positive (spec F11: no save-rate without views). */
export function exactRatio(numerator: MetricValue | null, denominator: MetricValue | null): number | null {
  if (!numerator || !denominator) return null;
  if (numerator.precision !== 'exact' || denominator.precision !== 'exact') return null;
  if (numerator.exact === null || denominator.exact === null || denominator.exact <= 0) return null;
  return numerator.exact / denominator.exact;
}
