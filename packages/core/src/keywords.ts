import type { KeywordProvenance } from '@xhs/domain';
import { z } from 'zod';
import type { Ctx } from './context.ts';

export const KeywordQuery = z.object({
  q: z.string().trim().max(50).optional(),
  provenance: z.enum(['observed_tag', 'observed_phrase', 'provider_related_term', 'editorial_seed', 'ai_suggestion']).optional(),
  topic: z.string().optional(),
  days: z.coerce.number().int().refine((d) => [7, 14, 30, 90].includes(d)).default(30),
});

export type KeywordCard = {
  id: string;
  rawText: string;
  canonicalText: string;
  kind: 'hashtag' | 'phrase';
  provenance: KeywordProvenance;
  meaningKo: string | null;
  topics: string[];
  reviewStatus: string;
  uniqueNotes: number;
  uniqueAuthors: number;
  latestObservedAt: string | null;
  exampleNoteIds: string[];
  saved: boolean;
};

export type KeywordList = { items: KeywordCard[]; sampleSize: number; windowDays: number; dataMode: string };

/**
 * Counts are unique notes / unique authors inside the stored sample and window.
 * They are observation counts, not search volume (spec 0.4, F06).
 */
export async function listKeywords(ctx: Ctx, input: unknown = {}): Promise<KeywordList> {
  const q = KeywordQuery.parse(input);
  const params: unknown[] = [ctx.orgId, ctx.mode, q.days, ctx.uid];
  const where = ['k.org_id = $1', 'k.data_mode = $2', "k.review_status <> 'retired'"];
  if (q.provenance) { params.push(q.provenance); where.push(`k.provenance = $${params.length}`); }
  if (q.topic) { params.push(q.topic); where.push(`$${params.length} = any(k.topics)`); }
  if (q.q) { params.push(`%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where.push(`(k.raw_text ilike $${params.length} or k.meaning_ko ilike $${params.length})`); }

  const sample = (await ctx.db.query<{ n: number }>(
    `select count(*)::int as n from notes where org_id = $1 and data_mode = $2 and not is_fallback and published_at >= now() - make_interval(days => $3)`,
    [ctx.orgId, ctx.mode, q.days],
  )).rows[0]?.n ?? 0;

  const rows = (await ctx.db.query(
    `select k.id, k.raw_text, k.canonical_text, k.kind, k.provenance, k.meaning_ko, k.topics, k.review_status,
            count(distinct n.id)::int as unique_notes, count(distinct n.author_ref)::int as unique_authors,
            max(n.observed_at) as latest, (array_agg(distinct n.id))[1:3] as examples,
            exists (select 1 from personal_saves s where s.target_type = 'keyword' and s.target_id = k.id and s.owner_user_id = $4) as saved
     from keywords k
     left join keyword_occurrences o on o.keyword_id = k.id
     left join notes n on n.id = o.note_id and not n.is_fallback and n.published_at >= now() - make_interval(days => $3)
     where ${where.join(' and ')}
     group by k.id
     order by count(distinct n.id) desc, k.raw_text
     limit 100`,
    params,
  )).rows;
  return {
    sampleSize: sample,
    windowDays: q.days,
    dataMode: ctx.mode,
    items: rows.map((r) => ({
      id: r.id, rawText: r.raw_text, canonicalText: r.canonical_text, kind: r.kind, provenance: r.provenance, meaningKo: r.meaning_ko,
      topics: r.topics, reviewStatus: r.review_status, uniqueNotes: r.unique_notes, uniqueAuthors: r.unique_authors,
      latestObservedAt: r.latest?.toISOString() ?? null, exampleNoteIds: (r.examples ?? []).filter(Boolean), saved: r.saved,
    })),
  };
}
