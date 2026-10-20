import { canonicalTerm } from '@xhs/domain';
import { analyzeSearchLanguage, chineseSearchCandidate, isChineseSearch } from './search-language.ts';
import type { NoteCard } from './discover.ts';
import type { SharedDictionaryEntry } from './shared-dictionary.ts';
import { keywordEvidence, keywordTrend, uniqueKeywordNotes } from './keyword-evidence.ts';

const TOPICS = [
  { match: /防晒|선크림|자외선/, root: '防晒', related: ['防晒霜', '防晒补涂', '防晒测评'], tails: ['敏感肌防晒霜推荐', '通勤防晒霜推荐', '油皮夏季防晒霜', '户外运动防晒'] },
  { match: /旅行|旅游|여행/, root: '旅行', related: ['旅行攻略', '自由行', '旅行穿搭'], tails: ['韩国旅行三天两夜攻略', '韩国亲子旅行攻略', '首尔雨天旅行攻略'] },
  { match: /穿搭|패션|코디/, root: '穿搭', related: ['日常穿搭', '通勤穿搭', '穿搭灵感'], tails: ['小个子通勤穿搭', '秋季简约穿搭', '微胖女生穿搭'] },
] as const;
export type KeywordRecommendation = {
  trend?: ReturnType<typeof keywordTrend>;
  performance?: ReturnType<typeof keywordEvidence>;
  aiReason?: string; term: string; group: 'core' | 'related' | 'longTail';
  dictionaryIds: string[]; meaning: string | null; cautions: string[];
  noteCount: number; evidence: { noteId: string; title: string }[]; suggested: boolean;
};

/** Suggestions are search hypotheses. Counts always come from this deduplicated sample. */
export function recommendKeywords(query: string, notes: readonly NoteCard[], dictionary: readonly SharedDictionaryEntry[]) {
  const zh = chineseSearchCandidate(query).text.replace(/^#+/, '').trim();
  const topic = TOPICS.find(t => t.match.test(query) || t.match.test(zh));
  const root = topic?.root ?? zh.replace(/推荐|攻略/g, '').trim();
  const sample = uniqueKeywordNotes(notes);
  const observed = analyzeSearchLanguage(sample, dictionary);
  const items = new Map<string, KeywordRecommendation>();
  function add(term: string, group: KeywordRecommendation['group'], suggested = false) {
    term = canonicalTerm(term);
    if (!isChineseSearch(term) || term.length < 2) return;
    const existing = items.get(term);
    if (existing) { existing.suggested ||= suggested; if (group === 'longTail' && existing.group !== 'core') existing.group = group; return; }
    const definitions = dictionary.filter(d => canonicalTerm(d.term) === term);
    const found = observed.tags.find(t => canonicalTerm(t.term) === term);
    items.set(term, { term, group, dictionaryIds: definitions.map(d => d.id), meaning: definitions[0]?.meaning ?? null,
      cautions: definitions.flatMap(d => d.cautions), noteCount: found?.noteCount ?? 0, evidence: found?.examples ?? [], suggested,
      ...(found ? {performance:keywordEvidence(term,sample),trend:keywordTrend(term,sample)} : {}) });
  }
  if (zh) add(zh, 'core');
  if (root && root !== zh) add(root, 'core');
  for (const item of dictionary) {
    if (item.entryType === 'tag' && root.length >= 2 && canonicalTerm(item.term).includes(root)) add(item.term, 'related');
  }
  for (const tag of observed.tags) {
    const term=canonicalTerm(tag.term);
    add(tag.term, root.length>=2 && term.includes(root) && term.length>=root.length+3 ? 'longTail' : 'related');
  }
  if (topic) {
    for (const term of topic.related) add(term, 'related', true);
    // Country-specific examples only belong to a Korean travel search.
    for (const term of topic.tails) if (topic.root !== '旅行' || /韩国|한국|首尔|서울/.test(query + zh)) add(term, 'longTail', true);
  }
  return { items: [...items.values()], sampleSize: observed.sampleSize, zh };
}
