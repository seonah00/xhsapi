import { describe, expect, it } from 'vitest';
import { comparePublications, reflect, ResultMetrics, type Publication } from '@xhs/core';

const pub = (id: string, p: Partial<Publication>, metrics: ResultMetrics | null, observedAt = '2026-10-04T00:00:00Z'): Publication => ({
  id, accountId: 'a', accountName: 'A', title: id, noteUrl: null, publishedAt: '2026-10-01T00:00:00Z', topic: 'beauty', format: 'vlog',
  sponsorship: 'no', paidPromotion: 'no', planVersionId: null, planId: null,
  snapshots: metrics ? [{ id: `s-${id}`, observedAt, enteredAt: observedAt, source: 'manual', metrics }] : [], ...p,
});

describe('comparePublications', () => {
  it('computes save rate only where views exist and keeps missing as null', () => {
    const c = comparePublications([
      pub('a', {}, { saves: 10, views: 100 }),
      pub('b', {}, { saves: 30 }),
      pub('c', { format: 'review' }, { likes: 5 }),
    ], 'format');
    const vlog = c.groups.find((g) => g.key === 'vlog')!;
    expect(vlog.saveRate).toEqual({ value: 0.1, basis: 1 });
    expect(vlog.median.saves).toBe(20);
    expect(c.groups.find((g) => g.key === 'review')!.median.saves).toBeNull();
    expect(c.warnings.join(' ')).toContain('3개 미만');
    expect(c.warnings.join(' ')).toContain('인과관계가 아닙니다');
  });

  it('warns about paid promotion and uneven observation windows', () => {
    const c = comparePublications([
      pub('a', { paidPromotion: 'yes' }, { saves: 1 }, '2026-10-02T00:00:00Z'),
      pub('b', {}, { saves: 2 }, '2026-10-20T00:00:00Z'),
    ], 'topic');
    expect(c.warnings.some((w) => w.includes('유료 프로모션'))).toBe(true);
    expect(c.warnings.some((w) => w.includes('관찰 시점'))).toBe(true);
  });
});

describe('reflect', () => {
  it('forms hypotheses from own data without causal claims', () => {
    const r = reflect([
      { title: '루틴 영상', topic: 'beauty', format: 'routine', metrics: { saves: 50 }, paid: 'no' },
      { title: '리뷰', topic: 'beauty', format: 'review', metrics: { saves: 5 }, paid: 'no' },
    ], ['s1', 's2']);
    expect(r.hypotheses[0]).toContain('형식');
    expect(r.limitations.join(' ')).toContain('계정 방향은 자동으로 바뀌지 않습니다');
    expect(r.limitations).toContain('표본이 매우 적습니다.');
  });
  it('declines to compare with too little data', () => {
    expect(reflect([{ title: 'x', topic: null, format: null, metrics: { likes: 3 }, paid: 'no' }], ['s']).observations[0]).toContain('비교하지 않았습니다');
  });
});
