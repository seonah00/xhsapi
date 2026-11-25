import { expect, it } from 'vitest';
import { recommendEntries, type RecommendationEntry } from '../../apps/web/src/app/app/dictionary/redi/recommend.ts';
const base: RecommendationEntry = { id: 'one', entryType: 'expression', term: '清透感', meaning: '맑은 느낌', usage: '가벼운 메이크업', cautions: [], categories: ['뷰티'] };
it('recommends matches only, across Korean meaning, usage and categories', () => {
  expect(recommendEntries([base], '')).toEqual([]);
  expect(recommendEntries([base], '카페')).toEqual([]);
  expect(recommendEntries([base], '뷰티')).toHaveLength(1);
  expect(recommendEntries([base], '메이크업')).toHaveLength(1);
  expect(recommendEntries([base], '맑은 뷰티')[0]?.score).toBe(2);
  expect(recommendEntries([base], '청투감')).toEqual([]);
});
