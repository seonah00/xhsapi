import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery } from '@xhs/domain';
import { DiscoverQuery } from '@xhs/core';
import { categorySearch } from '../../apps/web/src/components/category-search.ts';

describe('hashtag search input', () => {
  it('normalizes surrounding hashtag markers for stored and fresh search', () => {
    for (const q of [' #韩国旅行 ', '＃韩国旅行＃', '韩国旅行']) {
      expect(normalizeSearchQuery(q)).toBe('韩国旅行');
      expect(categorySearch(q, 'beauty')).toBe('韩国旅行');
      expect(DiscoverQuery.parse({q}).q).toBe('韩国旅行');
    }
    expect(categorySearch('', 'fashion')).toBe('穿搭');
    expect(normalizeSearchQuery('###')).toBe('');
  });
});
