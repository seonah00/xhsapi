import { normalizeSearchQuery, expandKoreanQuery, containsHangul, rankForProfile, REASON_TEXT, CON_TEXT, RANKING_VERSION, type MetricValue, type QueryExpansion, type TopicSlug, type FormatSlug } from '@xhs/domain';
import { coverExpired } from '@xhs/security';
import { z } from 'zod';
import type { Ctx } from './context.ts';
import type { AccountProfile } from './profile.ts';

export type NoteCard = {
  id: string;
  platformNoteId: string;
  title: string | null;
  bodyExcerpt: string | null;
  canonicalUrl: string;
  /** Provider preview image; organization membership and data expiry still apply. */
  coverUrl: string | null;
  fallbackCoverUrl?: string | null;
  noteType: 'video' | 'image' | null;
  authorName: string | null;
  authorRef: string | null;
  authorFollowers: MetricValue | null;
  publishedAt: string | null;
  observedAt: string | null;
  dataMode: 'mock' | 'live';
  topics: string[];
  formats: string[];
  tags: string[];
  metrics: Partial<Record<'likes' | 'saves' | 'comments' | 'shares' | 'views', MetricValue>>;
  saved: boolean;
};

export const DiscoverQuery = z.object({
  q: z.string().max(100).default('').transform(normalizeSearchQuery),
  job: z.string().uuid().optional(),
  topic: z.string().optional(),
  format: z.string().optional(),
  days: z.coerce.number().int().refine((d) => [7, 14, 30].includes(d)).optional(),
  /** popular = most likes, saves = most saves (latest snapshot; exact value or lower bound), recent = newest first. */
  sort: z.enum(['popular', 'saves', 'recent']).default('popular'),
  terms: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  cursor: z.string().max(40).optional(),
});
export type DiscoverQuery = z.infer<typeof DiscoverQuery>;

const PAGE = 50;

const metricOrder = (key: 'likes' | 'saves') => `(select coalesce((m.metrics_json->'${key}'->>'exact')::numeric, (m.metrics_json->'${key}'->>'lowerBound')::numeric)
  from metric_snapshots m where m.note_id = n.id order by m.observed_at desc limit 1) desc nulls last,`;
const ORDER: Record<'popular' | 'saves' | 'recent', string> = { popular: metricOrder('likes'), saves: metricOrder('saves'), recent: '' };

const NOTE_SELECT = `
  select n.id, n.platform_note_id, coalesce(e.title,n.title) as title, coalesce(e.body_excerpt,n.body_excerpt) as body_excerpt, n.canonical_url, coalesce(e.note_type,n.note_type) as note_type,
         coalesce(e.cover_url, case when n.cover_url is not null and app.org_allows_media_display(n.org_id) then n.cover_url end) as cover_url, case when app.org_allows_media_display(n.org_id) then n.cover_url end as source_cover_url, n.author_display_name, n.author_ref,
         n.author_followers, n.published_at, n.observed_at, n.data_mode, coalesce(nullif(e.provider_tags,'{}'::text[]),n.provider_tags) as provider_tags, n.is_fallback,
         coalesce((select array_agg(t.slug order by t.slug) from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id where nt.note_id = n.id and t.kind = 'topic'), '{}') as topics,
         coalesce((select array_agg(t.slug order by t.slug) from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id where nt.note_id = n.id and t.kind = 'format'), '{}') as formats,
         (coalesce((select m.metrics_json from metric_snapshots m where m.note_id = n.id order by m.observed_at desc limit 1), '{}'::jsonb) || coalesce(e.metrics_json, '{}'::jsonb)) as metrics,
         exists (select 1 from personal_saves s where s.target_type = 'note' and s.target_id = n.id and s.owner_user_id = $1) as saved
  from notes n left join note_enrichments e on e.note_id=n.id and e.org_id=n.org_id
    and app.can_read_note_enrichment(e.org_id,e.permission_id,e.expires_at)`;

type NoteRow = {
  id: string; platform_note_id: string; title: string | null; body_excerpt: string | null; canonical_url: string; cover_url: string | null; source_cover_url: string | null;
  note_type: 'video' | 'image' | null; author_display_name: string | null; author_ref: string | null; author_followers: MetricValue | null;
  published_at: Date | null; observed_at: Date | null; data_mode: 'mock' | 'live'; provider_tags: string[]; is_fallback: boolean;
  topics: string[]; formats: string[]; metrics: NoteCard['metrics'] | null; saved: boolean;
};

function toCard(r: NoteRow): NoteCard {
  return {
    id: r.id, platformNoteId: r.platform_note_id, title: r.title, bodyExcerpt: r.body_excerpt, canonicalUrl: r.canonical_url, coverUrl: r.cover_url && !coverExpired(r.cover_url) ? r.cover_url : null,
    fallbackCoverUrl: r.source_cover_url && r.source_cover_url !== r.cover_url && !coverExpired(r.source_cover_url) ? r.source_cover_url : null,
    noteType: r.note_type, authorName: r.author_display_name, authorRef: r.author_ref, authorFollowers: r.author_followers,
    publishedAt: r.published_at?.toISOString() ?? null, observedAt: r.observed_at?.toISOString() ?? null, dataMode: r.data_mode,
    topics: r.topics, formats: r.formats, tags: r.provider_tags, metrics: r.metrics ?? {}, saved: r.saved,
  };
}

export type DiscoverResult = {
  expansion: QueryExpansion | null;
  searchedTerms: string[];
  notes: NoteCard[];
  latestHot: NoteCard[];
  nextCursor: string | null;
  lastFetchedAt: string | null;
  postFilters: string[];
};

/**
 * Searches stored data only: no provider call and no cost (spec F04 step 1).
 * Korean queries are expanded via the editorial seed dictionary and the candidates are shown.
 */
export async function discover(ctx: Ctx, input: z.input<typeof DiscoverQuery>): Promise<DiscoverResult> {
  const q = DiscoverQuery.parse(input);
  let expansion: QueryExpansion | null = null;
  let terms: string[] = [];
  if (q.q) {
    if (containsHangul(q.q)) {
      expansion = expandKoreanQuery(q.q);
      const all = expansion.candidates.map((c) => c.text);
      terms = q.terms?.filter((t) => all.includes(t)) ?? all;
    } else {
      terms = [q.q];
    }
  }
  const offset = q.cursor ? Number.parseInt(Buffer.from(q.cursor, 'base64url').toString(), 10) || 0 : 0;
  const where: string[] = ['n.org_id = $2', 'n.data_mode = $3', 'not n.is_fallback'];
  const params: unknown[] = [ctx.uid, ctx.orgId, ctx.mode];
  const postFilters: string[] = [];

  if (q.job) {
    // Restrict fresh results to this user's search. Never expose another member's job payload.
    params.push(q.job);
    where.push(`exists (select 1 from app_jobs j where j.id=$${params.length}::uuid
      and j.org_id=n.org_id and j.owner_user_id=$1 and j.data_mode=$3 and j.kind='provider_search'
      and (coalesce(j.result_ref->'fetchedNoteIds',j.result_ref->'noteIds','[]'::jsonb) ? n.id::text))`);
  }

  if (q.q && terms.length === 0) {
    // Korean query with no candidate: report honestly instead of returning unrelated popular items.
    return { expansion, searchedTerms: [], notes: [], latestHot: await latestHot(ctx), nextCursor: null, lastFetchedAt: await lastFetched(ctx), postFilters };
  }
  if (terms.length) {
    params.push(terms.map((t) => `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
    const textParam = params.length;
    params.push([...new Set([q.q.trim(), ...terms])]);
    where.push(`(n.title ilike any($${textParam}) or n.body_excerpt ilike any($${textParam}) or exists (select 1 from unnest(n.provider_tags) t where t ilike any($${textParam}))
      or exists (select 1 from note_search_matches s where s.org_id=n.org_id and s.note_id=n.id and s.query_text=any($${params.length}::text[])))`);
  }
  if (q.topic) {
    params.push(q.topic);
    where.push(`exists (select 1 from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id where nt.note_id = n.id and t.kind = 'topic' and t.slug = $${params.length})`);
  }
  if (q.format) {
    params.push(q.format);
    where.push(`exists (select 1 from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id where nt.note_id = n.id and t.kind = 'format' and t.slug = $${params.length})`);
  }
  if (q.days) {
    params.push(q.days);
    where.push(`n.published_at >= now() - make_interval(days => $${params.length})`);
    postFilters.push('published_within_days');
  }
  params.push(PAGE + 1, offset);
  const rows = (await ctx.db.query<NoteRow>(
    `${NOTE_SELECT} where ${where.join(' and ')} order by ${ORDER[q.sort]} n.published_at desc nulls last, n.id limit $${params.length - 1} offset $${params.length}`,
    params,
  )).rows;
  const hasMore = rows.length > PAGE;
  return {
    expansion,
    searchedTerms: terms,
    notes: rows.slice(0, PAGE).map(toCard),
    latestHot: await latestHot(ctx),
    nextCursor: hasMore ? Buffer.from(String(offset + PAGE)).toString('base64url') : null,
    lastFetchedAt: await lastFetched(ctx),
    postFilters,
  };
}

async function latestHot(ctx: Ctx): Promise<NoteCard[]> {
  return (await ctx.db.query<NoteRow>(`${NOTE_SELECT} where n.org_id = $2 and n.data_mode = $3 and n.is_fallback order by n.observed_at desc limit 3`, [ctx.uid, ctx.orgId, ctx.mode])).rows.map(toCard);
}

export async function lastFetched(ctx: Ctx): Promise<string | null> {
  const r = await ctx.db.query<{ at: Date | null }>(
    `select max(actual_fetched_at) as at from ingestion_runs where org_id = $1 and data_mode = $2 and status in ('succeeded', 'partial')`,
    [ctx.orgId, ctx.mode],
  );
  return r.rows[0]?.at?.toISOString() ?? null;
}

export async function getNotes(ctx: Ctx, ids: readonly string[]): Promise<NoteCard[]> {
  if (ids.length === 0) return [];
  const rows = (await ctx.db.query<NoteRow>(`${NOTE_SELECT} where n.org_id = $2 and n.id = any($3::uuid[])`, [ctx.uid, ctx.orgId, ids])).rows;
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.map(toCard).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export type Recommendation = { note: NoteCard; reasons: string[]; cons: string[] };

/** Home recommendations: up to 6 explainable picks from stored data (spec 4.1). */
export async function recommend(ctx: Ctx, profile: AccountProfile, now = new Date()): Promise<{ items: Recommendation[]; rankingVersion: string; sampleSize: number }> {
  const rows = (await ctx.db.query<NoteRow>(
    `${NOTE_SELECT} where n.org_id = $2 and n.data_mode = $3 and not n.is_fallback order by n.published_at desc nulls last limit 300`,
    [ctx.uid, ctx.orgId, ctx.mode],
  )).rows.map(toCard);
  const ranked = rankForProfile(
    { mainTopic: profile.mainTopic, topics: profile.topics, formats: profile.formats, avoidTopics: profile.avoidTopics },
    rows.map((n) => ({ id: n.id, title: n.title, topics: n.topics, formats: n.formats, publishedAt: n.publishedAt, authorRef: n.authorRef, likes: n.metrics.likes ?? null, saves: n.metrics.saves ?? null, isFallback: false })),
    now,
  );
  const byId = new Map(rows.map((n) => [n.id, n]));
  return {
    items: ranked.map((r) => ({ note: byId.get(r.id)!, reasons: r.reasons.map((c) => REASON_TEXT[c]), cons: r.cons.map((c) => CON_TEXT[c]) })),
    rankingVersion: RANKING_VERSION,
    sampleSize: rows.length,
  };
}

export type { TopicSlug, FormatSlug };
