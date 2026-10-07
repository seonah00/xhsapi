import { normalizeSearchQuery } from '@xhs/domain';
export const CATEGORY_SEARCH: Record<string, string> = {
  beauty: '护肤', 'daily-life': '日常生活', parenting: '育儿',
  'food-places': '美食', 'travel-outing': '旅行', fashion: '穿搭',
};
export function categorySearch(query: string | undefined, topic: string | undefined): string {
  return normalizeSearchQuery(query ?? '') || (topic ? CATEGORY_SEARCH[topic] ?? '' : '');
}
