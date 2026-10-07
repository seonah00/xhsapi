import { describe, expect, it } from 'vitest';
import { classifyNote } from '@xhs/domain';

describe('keyword classifier for live notes', () => {
  it('labels topics and formats from title, excerpt and tags', () => {
    expect(classifyNote({ title: '首尔三天两晚自由行攻略', body: null, tags: ['首尔旅行'] })).toEqual({ topics: ['travel-outing'], formats: ['information-list'] });
    expect(classifyNote({ title: '敏感肌护肤真实测评', body: '用了一个月', tags: [] })).toEqual({ topics: ['beauty'], formats: ['review'] });
    expect(classifyNote({ title: 'Seoul VLOG | 探店咖啡馆', body: null, tags: [] })).toEqual({ topics: ['food-places'], formats: ['vlog'] });
  });
  it('gives no label rather than guessing', () => {
    expect(classifyNote({ title: '今天的心情', body: null, tags: [] })).toEqual({ topics: [], formats: [] });
  });
});
