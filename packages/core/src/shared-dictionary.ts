import { AppError, canonicalTerm, sha256Hex } from '@xhs/domain';
import { z } from 'zod';
import { requireAdmin } from './admin.ts';
import { notFound, type Ctx } from './context.ts';

export type DictionaryEntryType = 'tag' | 'expression';
export type SharedDictionaryEntry = {
  id: string;
  entryType: DictionaryEntryType;
  term: string;
  meaning: string;
  type: string;
  categories: string[];
  cautions: string[];
  groups: string[];
  observedCount: number | null;
  unknownTrendNote: string | null;
};
export type NormalizedDictionaryEntry = Omit<SharedDictionaryEntry, 'id'> & { canonicalKey: string };
export type DictionaryCounts = { tags: number; expressions: number; total: number };
export type NormalizedDictionaryImport = { entries: NormalizedDictionaryEntry[]; counts: DictionaryCounts };
export type DictionaryImportStatus = 'staged' | 'reviewed' | 'published';
export type DictionaryImportSummary = {
  id: string;
  label: string;
  status: DictionaryImportStatus;
  counts: DictionaryCounts;
  revision: number;
  createdAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
};
export type DictionaryImportDiffItem = {
  canonicalKey: string;
  entryType: DictionaryEntryType;
  term: string;
  action: 'create' | 'update' | 'unchanged';
};
export type DictionaryImportDetail = DictionaryImportSummary & {
  preview: {
    entries: NormalizedDictionaryEntry[];
    diff: { items: DictionaryImportDiffItem[]; counts: { create: number; update: number; unchanged: number } };
  };
  rawPayload?: unknown;
};
export type PublishDictionaryResult = {
  batchId: string;
  counts: DictionaryCounts;
  created: number;
  updated: number;
  unchanged: number;
};

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ENTRIES = 10_000;
const MAX_PAGE_SIZE = 100;

const StringItem = z.string().trim().min(1).max(200);
const RawEntry = z.object({
  id: z.string().trim().min(1).max(120),
  entryType: z.enum(['tag', 'expression']).optional(),
  term: z.string().trim().min(1).max(120),
  meaning: z.string().trim().min(1).max(1_000),
  kind: z.string().trim().min(1).max(120),
  categories: z.array(StringItem).max(20).default([]),
  mainCategories: z.array(StringItem).max(20).optional(),
  cautions: z.array(StringItem).max(20).default([]),
  groups: z.array(StringItem).max(20).default([]),
  observation_count: z.number().int().min(0).max(1_000_000).nullable().optional(),
  observedCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  trend_status: z.string().trim().max(200).nullable().optional(),
  unknownTrendNote: z.string().trim().max(200).nullable().optional(),
}).passthrough();

const RawImport = z.object({
  tags: z.array(RawEntry).max(MAX_IMPORT_ENTRIES),
  expressions: z.array(RawEntry).max(MAX_IMPORT_ENTRIES),
}).passthrough();

function invalid(message: string): never {
  throw new AppError('VALIDATION_FAILED', message);
}

function jsonBytes(raw: unknown): number {
  try {
    const encoded = JSON.stringify(raw);
    if (encoded === undefined) invalid('사전 원자료는 JSON 객체여야 합니다.');
    return Buffer.byteLength(encoded, 'utf8');
  } catch (e) {
    if (e instanceof AppError) throw e;
    invalid('사전 원자료를 JSON으로 읽을 수 없습니다.');
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function normalizeEntry(raw: z.infer<typeof RawEntry>, entryType: DictionaryEntryType): NormalizedDictionaryEntry {
  if (raw.entryType && raw.entryType !== entryType) invalid(`항목 ${raw.id}의 entryType이 배열과 맞지 않습니다.`);
  const termKey = canonicalTerm(raw.term);
  if (!termKey) invalid(`항목 ${raw.id}의 표제어가 비어 있습니다.`);
  const exactTerm = raw.term.normalize('NFKC').trim();
  const unknown = raw.unknownTrendNote ?? (raw.trend_status && /미검증|unknown|unverified/i.test(raw.trend_status) ? raw.trend_status : null);
  const preferredCategories = raw.mainCategories?.length ? raw.mainCategories : raw.categories;
  return {
    canonicalKey: `${entryType}:${termKey}:${sha256Hex(exactTerm).slice(0, 16)}`,
    entryType,
    term: raw.term,
    meaning: raw.meaning,
    type: raw.kind,
    categories: uniqueStrings(preferredCategories),
    cautions: uniqueStrings(raw.cautions),
    groups: uniqueStrings(raw.groups),
    observedCount: raw.observedCount ?? raw.observation_count ?? null,
    unknownTrendNote: unknown || null,
  };
}

/** Pure, bounded validation. Source records and non-allowlisted fields are deliberately discarded. */
export function normalizeDictionaryImport(raw: unknown): NormalizedDictionaryImport {
  if (jsonBytes(raw) > MAX_IMPORT_BYTES) invalid('사전 가져오기는 최대 2MB입니다.');
  const parsed = RawImport.safeParse(raw);
  if (!parsed.success) invalid('사전 형식이 올바르지 않습니다. tags와 expressions 항목을 확인하세요.');
  const total = parsed.data.tags.length + parsed.data.expressions.length;
  if (total > MAX_IMPORT_ENTRIES) invalid('사전 항목은 한 번에 최대 10,000개입니다.');
  const entries = [
    ...parsed.data.tags.map((entry) => normalizeEntry(entry, 'tag')),
    ...parsed.data.expressions.map((entry) => normalizeEntry(entry, 'expression')),
  ];
  // Exact case-preserving terms provide stable identities for case-fold
  // collisions (for example GRWM vs grwm), independent of array order. Only
  // exact duplicate terms need an opaque source fingerprint; raw source IDs
  // are never copied to the preview or published tables.
  const rawEntries = [...parsed.data.tags, ...parsed.data.expressions];
  const groups = new Map<string, number[]>();
  entries.forEach((entry, index) => groups.set(entry.canonicalKey, [...(groups.get(entry.canonicalKey) ?? []), index]));
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const entry = entries[index]!;
      const sourceFingerprint = sha256Hex(rawEntries[index]!.id).slice(0, 16);
      entry.canonicalKey = `${entry.canonicalKey}:${sourceFingerprint}`;
    }
  }
  if (new Set(entries.map((entry) => entry.canonicalKey)).size !== entries.length) invalid('완전히 중복된 사전 항목 ID가 있습니다.');
  return { entries, counts: { tags: parsed.data.tags.length, expressions: parsed.data.expressions.length, total } };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summary(row: any): DictionaryImportSummary {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    counts: { tags: row.tag_count, expressions: row.expression_count, total: row.entry_count },
    revision: row.revision,
    createdAt: iso(row.created_at)!,
    reviewedAt: iso(row.reviewed_at),
    publishedAt: iso(row.published_at),
  };
}

export async function listDictionaryImports(ctx: Ctx): Promise<DictionaryImportSummary[]> {
  requireAdmin(ctx);
  const rows = (await ctx.db.query(
    `select id, label, status, tag_count, expression_count, entry_count, revision, created_at, reviewed_at, published_at
       from dictionary_import_batches where org_id = $1 order by created_at desc limit 200`,
    [ctx.orgId],
  )).rows;
  return rows.map(summary);
}

export async function stageDictionaryImport(ctx: Ctx, input: { label: string; payload: unknown }): Promise<string> {
  requireAdmin(ctx);
  const label = z.string().trim().min(1).max(120).parse(input.label);
  const normalized = normalizeDictionaryImport(input.payload);
  return (await ctx.db.query<{ id: string }>(
    `insert into dictionary_import_batches
       (org_id, label, raw_payload, normalized_payload, tag_count, expression_count, entry_count, data_mode, staged_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [ctx.orgId, label, input.payload, normalized, normalized.counts.tags, normalized.counts.expressions, normalized.counts.total, ctx.mode, ctx.uid],
  )).rows[0]!.id;
}

function publicMeta(entry: NormalizedDictionaryEntry): Omit<NormalizedDictionaryEntry, 'canonicalKey' | 'entryType'> {
  return {
    term: entry.term,
    meaning: entry.meaning,
    type: entry.type,
    categories: entry.categories,
    cautions: entry.cautions,
    groups: entry.groups,
    observedCount: entry.observedCount,
    unknownTrendNote: entry.unknownTrendNote,
  };
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableJson(item)]));
  }
  return value;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableJson(a)) === JSON.stringify(stableJson(b));
}

export async function getDictionaryImport(ctx: Ctx, id: string): Promise<DictionaryImportDetail> {
  requireAdmin(ctx);
  const batch = (await ctx.db.query(
    `select id, label, status, raw_payload, normalized_payload, tag_count, expression_count, entry_count,
            data_mode, revision, created_at, reviewed_at, published_at
       from dictionary_import_batches where id = $1 and org_id = $2`,
    [z.string().uuid().parse(id), ctx.orgId],
  )).rows[0];
  if (!batch) notFound();
  const normalized = batch.normalized_payload as NormalizedDictionaryImport;
  const keys = normalized.entries.map((entry) => entry.canonicalKey);
  const current = keys.length ? (await ctx.db.query<{
    shared_dictionary_key: string; shared_dictionary_meta: unknown; review_status: string;
  }>(
    `select shared_dictionary_key, shared_dictionary_meta, review_status from keywords
       where org_id = $1 and data_mode = $3 and shared_dictionary_key = any($2::text[])
     union all
     select shared_dictionary_key, shared_dictionary_meta, review_status from expressions
       where org_id = $1 and data_mode = $3 and shared_dictionary_key = any($2::text[])`,
    [ctx.orgId, keys, batch.data_mode],
  )).rows : [];
  const byKey = new Map(current.map((row) => [row.shared_dictionary_key, row]));
  const items: DictionaryImportDiffItem[] = normalized.entries.map((entry) => {
    const existing = byKey.get(entry.canonicalKey);
    return {
      canonicalKey: entry.canonicalKey,
      entryType: entry.entryType,
      term: entry.term,
      action: !existing ? 'create'
        : existing.review_status === 'published' && sameJson(existing.shared_dictionary_meta, publicMeta(entry)) ? 'unchanged'
          : 'update',
    };
  });
  return {
    ...summary(batch),
    preview: {
      entries: normalized.entries,
      diff: {
        items,
        counts: {
          create: items.filter((item) => item.action === 'create').length,
          update: items.filter((item) => item.action === 'update').length,
          unchanged: items.filter((item) => item.action === 'unchanged').length,
        },
      },
    },
    rawPayload: batch.raw_payload,
  };
}

export async function reviewDictionaryImport(ctx: Ctx, id: string, confirmed: boolean): Promise<void> {
  requireAdmin(ctx);
  if (!confirmed) invalid('검토 완료를 확인해 주세요.');
  const r = await ctx.db.query(
    `update dictionary_import_batches
        set status = 'reviewed', reviewed_by = $3, reviewed_at = now(), revision = revision + 1
      where id = $1 and org_id = $2 and status = 'staged'`,
    [z.string().uuid().parse(id), ctx.orgId, ctx.uid],
  );
  if (!r.rowCount) throw new AppError('CONFLICT', '대기 중인 가져오기만 검토 완료할 수 있습니다.');
}

export async function publishDictionaryImport(ctx: Ctx, id: string, confirmed: boolean): Promise<PublishDictionaryResult> {
  requireAdmin(ctx);
  if (!confirmed) invalid('공개 반영을 확인해 주세요.');
  try {
    const r = (await ctx.db.query<{
      batch_id: string; tags: number; expressions: number; total: number; created_count: number; updated_count: number; unchanged_count: number;
    }>(`select * from app.publish_dictionary_import($1, $2, $3)`, [z.string().uuid().parse(id), ctx.orgId, ctx.uid])).rows[0];
    if (!r) notFound();
    return {
      batchId: r.batch_id,
      counts: { tags: r.tags, expressions: r.expressions, total: r.total },
      created: r.created_count,
      updated: r.updated_count,
      unchanged: r.unchanged_count,
    };
  } catch (e) {
    const message = String(e);
    if (/DICTIONARY_IMPORT_NOT_FOUND/.test(message)) notFound();
    if (/DICTIONARY_IMPORT_NOT_REVIEWED/.test(message)) throw new AppError('CONFLICT', '검토 완료된 가져오기만 공개할 수 있습니다.');
    if (/DICTIONARY_IMPORT_CATALOG_STALE/.test(message)) {
      throw new AppError('CONFLICT', '공용 사전이 검토 후 변경되었습니다. 다시 가져와 검토해 주세요.');
    }
    throw e;
  }
}

const SharedQuery = z.object({
  query: z.string().trim().max(100).optional(),
  entryType: z.enum(['tag', 'expression']).optional(),
  category: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});

function mapPublic(row: any): SharedDictionaryEntry {
  const meta = row.meta as Omit<SharedDictionaryEntry, 'id' | 'entryType'>;
  return {
    id: row.id,
    entryType: row.entry_type,
    term: meta.term,
    meaning: meta.meaning,
    type: meta.type,
    categories: meta.categories,
    cautions: meta.cautions,
    groups: meta.groups,
    observedCount: meta.observedCount ?? null,
    unknownTrendNote: meta.unknownTrendNote ?? null,
  };
}

export async function listSharedDictionary(
  ctx: Ctx,
  input: { query?: string; entryType?: DictionaryEntryType; category?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: SharedDictionaryEntry[]; total: number; page: number; pageSize: number; counts: { tags: number; expressions: number } }> {
  const q = SharedQuery.parse(input);
  const like = q.query ? `%${q.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = (await ctx.db.query(
    `with entries as (
       select id, 'tag'::text as entry_type, shared_dictionary_meta as meta
         from keywords where org_id = $1 and data_mode = $2 and shared_dictionary_key is not null and review_status = 'published'
       union all
       select id, 'expression'::text as entry_type, shared_dictionary_meta as meta
         from expressions where org_id = $1 and data_mode = $2 and owner_user_id is null and shared_dictionary_key is not null and review_status = 'published'
     ), filtered as (
       select * from entries
        where ($3::text is null or meta->>'term' ilike $3 escape '\\' or meta->>'meaning' ilike $3 escape '\\')
          and ($4::text is null or (meta->'categories') ? $4)
     ), counted as (
       select *, count(*) over ()::int as total,
              count(*) filter (where entry_type = 'tag') over ()::int as tags,
              count(*) filter (where entry_type = 'expression') over ()::int as expressions
         from filtered
     )
     select * from counted where ($5::text is null or entry_type = $5)
      order by lower(meta->>'term'), id limit $6 offset $7`,
    [ctx.orgId, ctx.mode, like, q.category ?? null, q.entryType ?? null, q.pageSize, (q.page - 1) * q.pageSize],
  )).rows;
  let total = 0;
  let counts = { tags: 0, expressions: 0 };
  if (rows[0]) {
    counts = { tags: rows[0].tags, expressions: rows[0].expressions };
    total = q.entryType === 'tag' ? counts.tags : q.entryType === 'expression' ? counts.expressions : rows[0].total;
  } else {
    const countRow = (await ctx.db.query(
      `with entries as (
         select 'tag'::text as entry_type, shared_dictionary_meta as meta from keywords
          where org_id = $1 and data_mode = $2 and shared_dictionary_key is not null and review_status = 'published'
         union all
         select 'expression'::text as entry_type, shared_dictionary_meta as meta from expressions
          where org_id = $1 and data_mode = $2 and owner_user_id is null and shared_dictionary_key is not null and review_status = 'published'
       ) select count(*) filter (where entry_type='tag')::int as tags,
                count(*) filter (where entry_type='expression')::int as expressions
           from entries where ($3::text is null or meta->>'term' ilike $3 escape '\\' or meta->>'meaning' ilike $3 escape '\\')
             and ($4::text is null or (meta->'categories') ? $4)`,
      [ctx.orgId, ctx.mode, like, q.category ?? null],
    )).rows[0];
    counts = { tags: countRow.tags, expressions: countRow.expressions };
    total = q.entryType === 'tag' ? counts.tags : q.entryType === 'expression' ? counts.expressions : counts.tags + counts.expressions;
  }
  return { items: rows.map(mapPublic), total, page: q.page, pageSize: q.pageSize, counts };
}

export async function getPublishedDictionaryEntries(ctx: Ctx, ids: string[]): Promise<SharedDictionaryEntry[]> {
  const clean = z.array(z.string().uuid()).max(1_000).parse(ids);
  if (!clean.length) return [];
  const rows = (await ctx.db.query(
    `select id, 'tag'::text as entry_type, shared_dictionary_meta as meta
       from keywords where org_id = $1 and data_mode = $3 and id = any($2::uuid[]) and shared_dictionary_key is not null and review_status = 'published'
     union all
     select id, 'expression'::text as entry_type, shared_dictionary_meta as meta
       from expressions where org_id = $1 and data_mode = $3 and id = any($2::uuid[]) and owner_user_id is null
         and shared_dictionary_key is not null and review_status = 'published'`,
    [ctx.orgId, clean, ctx.mode],
  )).rows;
  const mapped = new Map(rows.map((row) => [row.id as string, mapPublic(row)]));
  return clean.flatMap((id) => mapped.get(id) ? [mapped.get(id)!] : []);
}
