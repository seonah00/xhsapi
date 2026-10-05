import { AppError } from '@xhs/domain';
import { normalizeXhsNoteUrl, safeExternalHref, UnsafeUrlError } from '@xhs/security';
import { z } from 'zod';
import { notFound, type Ctx } from './context.ts';
import { getNotes, type NoteCard } from './discover.ts';

export const ReferenceCreate = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('saved_note'), noteId: z.string().uuid(), memo: z.string().max(5000).optional() }),
  z.object({ sourceType: z.literal('manual_url'), url: z.string().trim().min(1).max(2000), title: z.string().trim().max(200).optional(), memo: z.string().max(5000).optional(),
    licenseAssertion: z.enum(['reference_only', 'own_content', 'licensed']).default('reference_only') }),
  z.object({ sourceType: z.literal('pasted_text'), text: z.string().trim().min(1).max(20000), title: z.string().trim().max(200).optional(), memo: z.string().max(5000).optional(),
    licenseAssertion: z.enum(['reference_only', 'own_content', 'licensed']).default('reference_only') }),
]);
export type ReferenceCreate = z.infer<typeof ReferenceCreate>;

export type ReferenceRow = {
  id: string;
  sourceType: 'saved_note' | 'manual_url' | 'pasted_text' | 'image';
  title: string | null;
  manualUrl: string | null;
  userText: string | null;
  userMemo: string | null;
  tags: string[];
  favorite: boolean;
  collectionId: string | null;
  collectionName: string | null;
  licenseAssertion: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  note: NoteCard | null;
  noteId: string | null;
};

/** Saving a URL never triggers a crawl (spec F05). Xiaohongshu URLs are stored without access tokens. */
export async function createReference(ctx: Ctx, input: unknown): Promise<string> {
  const data = ReferenceCreate.parse(input);
  if (data.sourceType === 'saved_note') {
    const note = (await ctx.db.query(`select id, title from notes where id = $1 and org_id = $2 and not is_fallback`, [data.noteId, ctx.orgId])).rows[0];
    if (!note) notFound();
    const existing = (await ctx.db.query(`select id from reference_items where note_id = $1 and owner_user_id = $2 and deleted_at is null`, [data.noteId, ctx.uid])).rows[0];
    if (existing) return existing.id as string;
    return (await ctx.db.query<{ id: string }>(
      `insert into reference_items (org_id, owner_user_id, source_type, note_id, title, user_memo, analysis_scope)
       values ($1, $2, 'saved_note', $3, $4, $5, '{metadata_only}') returning id`,
      [ctx.orgId, ctx.uid, data.noteId, note.title, data.memo ?? null],
    )).rows[0]!.id;
  }
  if (data.sourceType === 'manual_url') {
    let url: string | null;
    try {
      url = normalizeXhsNoteUrl(data.url).canonicalUrl;
    } catch (e) {
      if (!(e instanceof UnsafeUrlError)) throw e;
      url = safeExternalHref(data.url);
    }
    if (!url) throw new AppError('VALIDATION_FAILED', 'http(s) 링크만 저장할 수 있습니다.');
    return (await ctx.db.query<{ id: string }>(
      `insert into reference_items (org_id, owner_user_id, source_type, manual_url, title, user_memo, license_assertion, analysis_scope)
       values ($1, $2, 'manual_url', $3, $4, $5, $6, '{user_notes_only}') returning id`,
      [ctx.orgId, ctx.uid, url, data.title ?? null, data.memo ?? null, data.licenseAssertion],
    )).rows[0]!.id;
  }
  return (await ctx.db.query<{ id: string }>(
    `insert into reference_items (org_id, owner_user_id, source_type, user_text, title, user_memo, license_assertion, analysis_scope)
     values ($1, $2, 'pasted_text', $3, $4, $5, $6, '{body_only}') returning id`,
    [ctx.orgId, ctx.uid, data.text, data.title ?? null, data.memo ?? null, data.licenseAssertion],
  )).rows[0]!.id;
}

export const ReferenceListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  collectionId: z.string().uuid().optional(),
  favorite: z.coerce.boolean().optional(),
  trash: z.coerce.boolean().optional(),
  sort: z.enum(['updated', 'created', 'title']).default('updated'),
});

const REF_SELECT = `
  select r.id, r.source_type, r.title, r.manual_url, r.user_text, r.user_memo, r.tags, r.favorite, r.collection_id, c.name as collection_name,
         r.license_assertion, r.revision, r.created_at, r.updated_at, r.deleted_at, r.note_id
  from reference_items r left join collections c on c.id = r.collection_id`;

type RefDbRow = {
  id: string; source_type: ReferenceRow['sourceType']; title: string | null; manual_url: string | null; user_text: string | null; user_memo: string | null;
  tags: string[]; favorite: boolean; collection_id: string | null; collection_name: string | null; license_assertion: string; revision: number;
  created_at: Date; updated_at: Date; deleted_at: Date | null; note_id: string | null;
};

async function hydrate(ctx: Ctx, rows: RefDbRow[]): Promise<ReferenceRow[]> {
  const notes = new Map((await getNotes(ctx, rows.map((r) => r.note_id).filter((x): x is string => !!x))).map((n) => [n.id, n]));
  return rows.map((r) => ({
    id: r.id, sourceType: r.source_type, title: r.title, manualUrl: r.manual_url, userText: r.user_text, userMemo: r.user_memo, tags: r.tags,
    favorite: r.favorite, collectionId: r.collection_id, collectionName: r.collection_name, licenseAssertion: r.license_assertion, revision: r.revision,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), deletedAt: r.deleted_at?.toISOString() ?? null,
    noteId: r.note_id, note: r.note_id ? notes.get(r.note_id) ?? null : null,
  }));
}

export async function listReferences(ctx: Ctx, input: unknown = {}): Promise<ReferenceRow[]> {
  const q = ReferenceListQuery.parse(input);
  const where = ['r.org_id = $1', 'r.owner_user_id = $2', q.trash ? 'r.deleted_at is not null' : 'r.deleted_at is null'];
  const params: unknown[] = [ctx.orgId, ctx.uid];
  if (q.q) {
    params.push(`%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    where.push(`(r.title ilike $${params.length} or r.user_memo ilike $${params.length} or r.user_text ilike $${params.length} or exists (select 1 from unnest(r.tags) t where t ilike $${params.length}))`);
  }
  if (q.collectionId) { params.push(q.collectionId); where.push(`r.collection_id = $${params.length}`); }
  if (q.favorite) where.push('r.favorite');
  const order = { updated: 'r.updated_at desc', created: 'r.created_at desc', title: 'r.title asc nulls last' }[q.sort];
  return hydrate(ctx, (await ctx.db.query<RefDbRow>(`${REF_SELECT} where ${where.join(' and ')} order by ${order} limit 200`, params)).rows);
}

export async function getReference(ctx: Ctx, id: string, opts: { includeDeleted?: boolean } = {}): Promise<ReferenceRow> {
  const rows = (await ctx.db.query<RefDbRow>(`${REF_SELECT} where r.id = $1 and r.org_id = $2 and r.owner_user_id = $3`, [id, ctx.orgId, ctx.uid])).rows;
  const [row] = await hydrate(ctx, rows);
  if (!row || (row.deletedAt && !opts.includeDeleted)) notFound();
  return row;
}

export const ReferenceUpdate = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  memo: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  favorite: z.boolean().optional(),
  collectionId: z.string().uuid().nullable().optional(),
  revision: z.number().int().positive(),
});

export async function updateReference(ctx: Ctx, id: string, input: unknown): Promise<number> {
  const u = ReferenceUpdate.parse(input);
  const sets: string[] = [];
  const params: unknown[] = [id, ctx.uid, u.revision];
  const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (u.title !== undefined) add('title', u.title);
  if (u.memo !== undefined) add('user_memo', u.memo);
  if (u.tags !== undefined) add('tags', u.tags);
  if (u.favorite !== undefined) add('favorite', u.favorite);
  if (u.collectionId !== undefined) add('collection_id', u.collectionId);
  if (sets.length === 0) return u.revision;
  const r = await ctx.db.query<{ revision: number }>(
    `update reference_items set ${sets.join(', ')}, revision = revision + 1 where id = $1 and owner_user_id = $2 and revision = $3 and deleted_at is null returning revision`,
    params,
  );
  if (r.rowCount !== 1) {
    await getReference(ctx, id); // 404 if not visible
    throw new AppError('STALE_REVISION', '다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.');
  }
  return r.rows[0]!.revision;
}

export async function trashReference(ctx: Ctx, id: string, trashed: boolean): Promise<void> {
  const r = await ctx.db.query(
    `update reference_items set deleted_at = ${trashed ? 'now()' : 'null'}, revision = revision + 1 where id = $1 and owner_user_id = $2 and org_id = $3`,
    [id, ctx.uid, ctx.orgId],
  );
  if (r.rowCount !== 1) notFound();
}

export async function listCollections(ctx: Ctx) {
  return (await ctx.db.query<{ id: string; name: string; count: number }>(
    `select c.id, c.name, (select count(*)::int from reference_items r where r.collection_id = c.id and r.deleted_at is null) as count
     from collections c where c.org_id = $1 and c.owner_user_id = $2 order by c.name`, [ctx.orgId, ctx.uid],
  )).rows;
}

export async function createCollection(ctx: Ctx, name: string): Promise<string> {
  const n = z.string().trim().min(1).max(80).parse(name);
  return (await ctx.db.query<{ id: string }>(`insert into collections (org_id, owner_user_id, name) values ($1, $2, $3) returning id`, [ctx.orgId, ctx.uid, n])).rows[0]!.id;
}

export type SaveTarget = 'note' | 'keyword' | 'expression';

/** Saves are validated against the target's org/visibility by a DB trigger. */
export async function toggleSave(ctx: Ctx, targetType: SaveTarget, targetId: string): Promise<boolean> {
  const del = await ctx.db.query(`delete from personal_saves where owner_user_id = $1 and target_type = $2 and target_id = $3`, [ctx.uid, targetType, targetId]);
  if (del.rowCount) return false;
  try {
    await ctx.db.query(`insert into personal_saves (org_id, owner_user_id, target_type, target_id) values ($1, $2, $3, $4)`, [ctx.orgId, ctx.uid, targetType, targetId]);
  } catch (e) {
    if (/INVALID_TARGET/.test(String(e))) notFound();
    throw e;
  }
  return true;
}
