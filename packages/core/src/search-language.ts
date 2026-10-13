import { canonicalTerm, extractHashtags, KO_ZH_SEED, containsHangul, normalizeSearchQuery } from '@xhs/domain';
import type { NoteCard } from './discover.ts';
import type { SharedDictionaryEntry } from './shared-dictionary.ts';

/** Composes one query instead of broadening a multiword intent into unrelated OR terms. */
export function chineseSearchCandidate(raw: string): { text: string; unmatched: string[] } {
  let text = normalizeSearchQuery(raw);
  const entries = Object.entries({ ...KO_ZH_SEED, 한국: ['韩国'], 성수동: ['圣水洞'], 성수: ['圣水'], 홍대: ['弘大'], 명동: ['明洞'], 강남: ['江南'], 추천: ['推荐'], 쇼핑: ['购物'], 음식: ['美食'], 다이어트: ['减脂'], 운동: ['运动'], 헤어: ['发型'], 네일: ['美甲'] })
    .sort(([a], [b]) => b.length - a.length);
  for (const [ko, zh] of entries) text = text.replaceAll(ko, zh[0]!);
  const unmatched = text.match(/[가-힣]+/g) ?? [];
  return { text: unmatched.length ? '' : text, unmatched };
}

export function isChineseSearch(value: string) {
  return value.length > 0 && value.length <= 50 && !containsHangul(value) && /[\p{Script=Han}a-z]/iu.test(value);
}

export type ObservedTerm = {
  term: string; kind: 'tag' | 'expression'; noteCount: number; authorCount: number;
  meaning: string | null; cautions: string[]; examples: { noteId: string; title: string; context: string }[];
};

/** Exact occurrences only. Dictionary metadata supplies explanations, never observed counts. */
export function analyzeSearchLanguage(notes: readonly NoteCard[], dictionary: readonly SharedDictionaryEntry[]) {
  const sample = [...new Map(notes.map(n => [n.platformNoteId || n.id, n])).values()];
  const definitions = new Map(dictionary.map(d => [`${d.entryType}:${canonicalTerm(d.term)}`, d]));
  const terms = new Map<string, { item: ObservedTerm; notes: Set<string>; authors: Set<string> }>();
  function add(term: string, kind: 'tag' | 'expression', note: NoteCard, context: string) {
    const canonical = canonicalTerm(term);
    if (!canonical || canonical.length > 80) return;
    const key = `${kind}:${canonical}`;
    const definition = definitions.get(key);
    let entry = terms.get(key);
    if (!entry) {
      entry = { item: { term, kind, meaning: definition?.meaning ?? null, cautions: definition?.cautions ?? [], noteCount: 0, authorCount: 0, examples: [] }, notes: new Set(), authors: new Set() };
      terms.set(key, entry);
    }
    if (entry.notes.has(note.id)) return;
    entry.notes.add(note.id);
    if (note.authorRef) entry.authors.add(note.authorRef);
    if (entry.item.examples.length < 3) entry.item.examples.push({ noteId: note.id, title: note.title ?? '제목 없음', context });
  }
  for (const note of sample) {
    const text = [note.title, note.bodyExcerpt].filter(Boolean).join('\n').normalize('NFKC').replace(/https?:\/\/\S+/gi, '[링크]');
    for (const tag of [...note.tags, ...extractHashtags(text)]) add(tag.normalize('NFKC').replace(/^#+|#+$/g, '').replace(/\[话题\]$/, '').trim(), 'tag', note, `#${canonicalTerm(tag)}`);
    const candidates = new Set([
      ...dictionary.filter(d => d.entryType === 'expression').map(d => d.term.normalize('NFKC')),
      ...Array.from(text.matchAll(/(?<![a-zA-Z0-9])[a-zA-Z]{2,12}(?![a-zA-Z0-9])/g), m => m[0]).filter(t => !/^(https?|www|com|vlog)$/i.test(t)),
    ]);
    for (const term of candidates) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!escaped) continue;
      const match = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'iu').exec(text);
      if (!match) continue;
      add(term, 'expression', note, text.slice(Math.max(0, match.index - 35), match.index + term.length + 55));
    }
  }
  const items = [...terms.values()].map(e => ({ ...e.item, noteCount: e.notes.size, authorCount: e.authors.size }))
    .sort((a, b) => b.noteCount - a.noteCount || a.term.localeCompare(b.term, 'zh-CN'));
  const dates = sample.flatMap(n => n.observedAt ? [n.observedAt] : []).sort();
  return { sampleSize: sample.length, from: dates[0] ?? null, to: dates.at(-1) ?? null, tags: items.filter(t => t.kind === 'tag').slice(0, 30), expressions: items.filter(t => t.kind === 'expression').slice(0, 30) };
}

/** Only published definitions actually present in this authorized result sample. */
export async function observedDictionary(ctx: import('./context.ts').Ctx, notes: readonly NoteCard[]) {
  const text = notes.flatMap(n => [n.title ?? '', n.bodyExcerpt ?? '', ...n.tags]).join('\n').normalize('NFKC').toLowerCase();
  const rows = (await ctx.db.query<{id:string}>(`select id from (
    select id,shared_dictionary_meta as meta from keywords where org_id=$1 and data_mode=$2 and review_status='published' and shared_dictionary_key is not null
    union all
    select id,shared_dictionary_meta as meta from expressions where org_id=$1 and data_mode=$2 and review_status='published' and owner_user_id is null and shared_dictionary_key is not null
  ) d where length(meta->>'term')>0 and position(lower(trim(both '#' from meta->>'term')) in $3)>0 order by id limit 1000`, [ctx.orgId,ctx.mode,text])).rows;
  const { getPublishedDictionaryEntries } = await import('./shared-dictionary.ts');
  return getPublishedDictionaryEntries(ctx,rows.map(r=>r.id));
}
