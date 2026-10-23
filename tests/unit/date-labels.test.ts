import { describe, expect, it } from 'vitest';
import { fmtDate } from '../../apps/web/src/components/labels';

describe('Korean date labels shared by SSR and hydration', () => {
  it('uses Korean afternoon text even when Node ICU returns PM', () => {
    expect(fmtDate('2026-10-12T10:01:00.000Z', true)).toBe('2026년 10월 12일 오후 07:01');
  });
  it('uses Korean morning text and the Korean calendar day at midnight', () => {
    expect(fmtDate('2026-10-11T15:00:00.000Z', true)).toBe('2026년 10월 12일 오전 12:00');
  });
  it('formats noon and dates without a time consistently', () => {
    expect(fmtDate('2026-10-12T03:05:00.000Z', true)).toBe('2026년 10월 12일 오후 12:05');
    expect(fmtDate('2026-10-11T15:00:00.000Z')).toBe('2026년 10월 12일');
  });
  it('keeps the missing-date label', () => {
    expect(fmtDate(null)).toBe('미확인');
    expect(fmtDate(undefined)).toBe('미확인');
    expect(fmtDate('')).toBe('미확인');
  });
});
