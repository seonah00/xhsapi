export type RecommendationEntry = { id: string; entryType: 'tag' | 'expression'; term: string; meaning: string; usage: string; cautions: string[]; categories: string[] };
export function recommendEntries(items: RecommendationEntry[], query: string) {
  const words = query.slice(0, 100).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 8);
  return items.map(item => ({ item, score: words.reduce((sum, word) => sum + ([item.term, item.meaning, item.usage, ...item.categories].join(' ').toLocaleLowerCase().includes(word) ? 1 : 0), 0) })).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.item.term.localeCompare(b.item.term));
}
