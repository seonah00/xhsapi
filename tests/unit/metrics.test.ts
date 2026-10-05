import { describe, expect, it } from 'vitest';
import { exactRatio, parseMetricValue } from '@xhs/domain';

describe('parseMetricValue', () => {
  it('keeps 4w+ as a lower bound, not an exact 40000', () => {
    expect(parseMetricValue('4w+')).toEqual({ raw: '4w+', exact: null, lowerBound: 40000, upperBound: null, precision: 'lower_bound' });
  });
  it('treats missing values as unknown, never 0', () => {
    for (const v of [null, undefined, '']) {
      const m = parseMetricValue(v);
      expect(m.precision).toBe('unknown');
      expect(m.exact).toBeNull();
    }
  });
  it('parses plain integers as exact', () => {
    expect(parseMetricValue(1234).exact).toBe(1234);
    expect(parseMetricValue('23,001').exact).toBe(23001);
  });
  it('keeps abbreviated values as an estimate with rounding interval', () => {
    expect(parseMetricValue('1.2万')).toMatchObject({ exact: null, lowerBound: 11500, upperBound: 12500, precision: 'estimated' });
  });
  it('parses ranges', () => {
    expect(parseMetricValue('3000-5000')).toMatchObject({ lowerBound: 3000, upperBound: 5000, precision: 'range' });
    expect(parseMetricValue('1-2w')).toMatchObject({ lowerBound: 10000, upperBound: 20000, precision: 'range' });
  });
  it('rejects garbage without inventing numbers', () => {
    expect(parseMetricValue('很多')).toMatchObject({ raw: '很多', exact: null, precision: 'unknown' });
    expect(parseMetricValue(-3).precision).toBe('unknown');
  });
});

describe('exactRatio', () => {
  it('does not compute save rate without exact views', () => {
    expect(exactRatio(parseMetricValue(100), parseMetricValue(null))).toBeNull();
    expect(exactRatio(parseMetricValue(100), parseMetricValue('4w+'))).toBeNull();
    expect(exactRatio(parseMetricValue(100), parseMetricValue(0))).toBeNull();
    expect(exactRatio(parseMetricValue(100), parseMetricValue(400))).toBe(0.25);
  });
});
