import { storeNoteAccessLink } from './note-links.ts';
import { canonicalTerm, classifyNote, CLASSIFIER_VERSION, extractHashtags, sha256Hex, canonicalJson } from '@xhs/domain';
import type { ProviderNote, SearchResult } from '@xhs/providers';
import type { Db } from './context.ts';

export type IngestMeta = {
  orgId: string;
  provider: string;
  endpoint: string;
  query: Record<string, unknown>;
  permissionId?: string | null;
};

/**
 * Stores a provider search result (service role). Keeps provenance, observation
 * time and coverage; fallback items (latestHotArticles) are stored flagged and
 * never counted as observations (spec F04, F06).
 */
export async function ingestSearchResult(db: Db, meta: IngestMeta, result: SearchResult): Promise<{ runId: string; noteIds: string[] }> {
  const runId = (await db.query<{ id: string }>(
    `insert into ingestion_runs (org_id, provider, endpoint, data_mode, query_hash, normalized_params, status, actual_fetched_at, coverage_json, permission_id)
     values ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, $9) returning id`,
    [meta.orgId, meta.provider, meta.endpoint, result.mode, sha256Hex(canonicalJson(meta.query)), meta.query, result.fetchedAt,
     { ...result.coverage, notes: result.notes.length, fallback: result.latestHotArticles.length }, meta.permissionId ?? null],
  )).rows[0]!.id;

  const taxonomy = new Map((await db.query<{ id: string; kind: string; slug: string }>(
    `select id, kind, slug from taxonomy_terms where org_id is null and active and kind in ('topic', 'format')`,
  )).rows.map((t) => [`${t.kind}:${t.slug}`, t.id]));

  const noteIds: string[] = [];
  for (const note of result.notes) noteIds.push(await upsertNote(db, meta, result, runId, note, false, taxonomy));
  const searchQuery = typeof meta.query.query === 'string' ? meta.query.query.trim() : '';
  if (searchQuery && noteIds.length) {
    await db.query(`insert into note_search_matches(org_id,note_id,query_text)
      select $1, unnest($2::uuid[]), $3 on conflict do nothing`, [meta.orgId,noteIds,searchQuery]);
  }
  for (const note of result.latestHotArticles) await upsertNote(db, meta, result, runId, note, true, taxonomy);

  for (const term of result.relatedTerms) {
    await db.query(
      `insert into keywords (org_id, canonical_text, raw_text, kind, provenance, data_mode, review_status)
       values ($1, $2, $3, 'phrase', 'provider_related_term', $4, 'draft') on conflict do nothing`,
      [meta.orgId, canonicalTerm(term), term, result.mode],
    );
  }
  return { runId, noteIds };
}

async function upsertNote(db: Db, meta: IngestMeta, result: SearchResult, runId: string, n: ProviderNote, isFallback: boolean, taxonomy: Map<string, string>): Promise<string> {
  const provenance = {
    provider: meta.provider, endpoint: result.endpoint, mode: result.mode, sourceUrl: n.canonicalUrl,
    publishedAt: n.publishedAt, fetchedAt: result.fetchedAt, providerSnapshotAt: n.providerSnapshotAt,
    analysisScope: 'metadata_only', permissionId: meta.permissionId ?? null, collectionStrategyVersion: 'v1',
  };
  const id = (await db.query<{ id: string }>(
    `insert into notes (org_id, provider, platform_note_id, data_mode, canonical_url, note_type, title, body_excerpt, author_ref, author_display_name,
                        author_followers, published_at, provenance, provider_tags, is_fallback, ingestion_run_id, observed_at, cover_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (org_id, provider, platform_note_id, data_mode) do update set
       title = excluded.title, body_excerpt = excluded.body_excerpt, canonical_url = excluded.canonical_url,
       -- endpoints differ in what they return (RF02 has no follower count, RF01 no type/cover): keep known values
       author_followers = case when excluded.author_followers->>'precision' = 'unknown' then notes.author_followers else excluded.author_followers end,
       note_type = coalesce(excluded.note_type, notes.note_type),
       cover_url = coalesce(excluded.cover_url, notes.cover_url),
       provenance = excluded.provenance, provider_tags = excluded.provider_tags, observed_at = excluded.observed_at,
       ingestion_run_id = excluded.ingestion_run_id,
       -- a note seen once as a real result is not demoted by a later fallback appearance
       is_fallback = notes.is_fallback and excluded.is_fallback
     returning id`,
    [meta.orgId, meta.provider, n.platformNoteId, result.mode, n.canonicalUrl, n.noteType, n.title, n.bodyExcerpt, n.author.ref,
     n.author.displayName, n.author.followers, n.publishedAt, provenance, n.providerTags, isFallback, runId, result.fetchedAt, n.coverUrl ?? null],
  )).rows[0]!.id;

  await storeNoteAccessLink(db, meta.orgId, id, n.platformNoteId, n.accessUrl);

  await db.query(
    `insert into metric_snapshots (note_id, observed_at, provider_snapshot_at, metrics_json, ingestion_run_id) values ($1, $2, $3, $4, $5)`,
    [id, result.fetchedAt, n.providerSnapshotAt, n.metrics, runId],
  );
  // Provider/fixture labels when given; otherwise our keyword classifier (low confidence, see @xhs/domain classify).
  const provided = n.topics.length > 0 || n.formats.length > 0;
  const labels = provided ? { topics: n.topics, formats: n.formats } : classifyNote({ title: n.title, body: n.bodyExcerpt, tags: n.providerTags });
  const [version, confidence] = provided ? ['provider-map-v1', 'medium'] : [CLASSIFIER_VERSION, 'low'];
  for (const [kind, slugs] of [['topic', labels.topics], ['format', labels.formats]] as const) {
    for (const slug of slugs) {
      const tid = taxonomy.get(`${kind}:${slug}`);
      if (tid) {
        await db.query(
          `insert into note_taxonomy (note_id, taxonomy_id, classifier_version, confidence) values ($1, $2, $3, $4) on conflict do nothing`,
          [id, tid, version, confidence],
        );
      }
    }
  }
  if (isFallback) return id;

  // Provider tags and in-body hashtags are both hashtag observations; body phrases are not.
  const tags = new Map<string, string>();
  for (const t of [...n.providerTags, ...extractHashtags(n.bodyExcerpt)]) {
    const key = canonicalTerm(t);
    if (key) tags.set(key, t);
  }
  for (const [canonical, raw] of tags) {
    const kw = (await db.query<{ id: string }>(
      `insert into keywords (org_id, canonical_text, raw_text, kind, provenance, data_mode, topics)
       values ($1, $2, $3, 'hashtag', 'observed_tag', $4, $5)
       on conflict (org_id, canonical_text, kind, provenance, data_mode) do update set topics = (
         select array(select distinct unnest(keywords.topics || excluded.topics)))
       returning id`,
      [meta.orgId, canonical, raw, result.mode, n.topics],
    )).rows[0]!.id;
    await db.query(
      `insert into keyword_occurrences (keyword_id, note_id, field, ingestion_run_id) values ($1, $2, 'tags', $3) on conflict do nothing`,
      [kw, id, runId],
    );
  }
  return id;
}
