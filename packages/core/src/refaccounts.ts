import { AppError, type MetricValue } from '@xhs/domain';
import { z } from 'zod';
import { notFound, type Ctx } from './context.ts';
import { getNotes, type NoteCard } from './discover.ts';

export type AccountCandidate = {
  authorRef: string; displayName: string; followers: MetricValue | null; noteCount: number; topics: string[]; formats: string[]; latestObservedAt: string | null; saved: boolean;
};

/**
 * Spec F14 (P0): candidates come from stored notes grouped by author. No provider
 * call; provider growth rankings are shown as unavailable until connected.
 */
export async function accountCandidates(ctx: Ctx, input: { q?: string; topic?: string } = {}): Promise<AccountCandidate[]> {
  const q = z.object({ q: z.string().trim().max(50).optional(), topic: z.string().max(40).optional() }).parse(input);
  const like = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return (await ctx.db.query(
    `with a as (
       select n.author_ref, max(n.author_display_name) as name, count(*)::int as notes, max(n.observed_at) as observed,
              (array_agg(n.author_followers order by n.observed_at desc nulls last))[1] as followers,
              array(select distinct t.slug from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id join notes n2 on n2.id = nt.note_id
                    where n2.author_ref = n.author_ref and n2.org_id = $1 and n2.data_mode = $2 and t.kind = 'topic') as topics,
              array(select distinct t.slug from note_taxonomy nt join taxonomy_terms t on t.id = nt.taxonomy_id join notes n2 on n2.id = nt.note_id
                    where n2.author_ref = n.author_ref and n2.org_id = $1 and n2.data_mode = $2 and t.kind = 'format') as formats,
              bool_or(n.title ilike $3 or n.author_display_name ilike $3) as matched
       from notes n where n.org_id = $1 and n.data_mode = $2 and not n.is_fallback and n.author_ref is not null
       group by n.author_ref)
     select a.*, exists (select 1 from reference_accounts r where r.owner_user_id = $5 and r.provider_user_id = a.author_ref and r.data_mode = $2) as saved
     from a where ($3::text is null or a.matched) and ($4::text is null or $4 = any(a.topics))
     order by a.notes desc, a.name limit 50`,
    [ctx.orgId, ctx.mode, like, q.topic ?? null, ctx.uid],
  )).rows.map((r) => ({ authorRef: r.author_ref, displayName: r.name ?? r.author_ref, followers: r.followers, noteCount: r.notes, topics: r.topics, formats: r.formats,
    latestObservedAt: r.observed?.toISOString() ?? null, saved: r.saved }));
}

/** Saves a reference account separately from the student's own accounts (never merged with own results). */
export async function saveReferenceAccount(ctx: Ctx, authorRef: string): Promise<string> {
  const c = (await accountCandidates(ctx)).find((x) => x.authorRef === authorRef) ?? null;
  if (!c) notFound();
  const existing = (await ctx.db.query(`select id from reference_accounts where owner_user_id = $1 and provider_user_id = $2 and data_mode = $3`, [ctx.uid, authorRef, ctx.mode])).rows[0];
  if (existing) return existing.id as string;
  return (await ctx.db.query<{ id: string }>(
    `insert into reference_accounts (org_id, owner_user_id, provider, provider_user_id, id_kind, display_name, profile_url, snapshot_json, observed_at, data_mode)
     values ($1, $2, $3, $4, 'unknown', $5, null, $6, coalesce($7::timestamptz, now()), $8) returning id`,
    [ctx.orgId, ctx.uid, ctx.mode === 'mock' ? 'mock' : 'redfox', authorRef, c.displayName,
     { followers: c.followers, noteCount: c.noteCount, topics: c.topics, formats: c.formats, basis: 'stored_notes' }, c.latestObservedAt, ctx.mode],
  )).rows[0]!.id;
}

export type ReferenceAccount = {
  id: string; displayName: string; providerUserId: string; idKind: string; profileUrl: string | null; observedAt: string; dataMode: string;
  snapshot: { followers: MetricValue | null; noteCount: number; topics: string[]; formats: string[]; basis: string };
};

export async function listReferenceAccounts(ctx: Ctx): Promise<ReferenceAccount[]> {
  return (await ctx.db.query(`select * from reference_accounts where org_id = $1 and owner_user_id = $2 order by saved_at desc`, [ctx.orgId, ctx.uid])).rows.map(toAccount);
}

function toAccount(r: Record<string, any>): ReferenceAccount {
  return { id: r.id, displayName: r.display_name, providerUserId: r.provider_user_id, idKind: r.id_kind, profileUrl: r.profile_url, observedAt: r.observed_at.toISOString(), dataMode: r.data_mode, snapshot: r.snapshot_json };
}

export async function getReferenceAccount(ctx: Ctx, id: string): Promise<{ account: ReferenceAccount; notes: NoteCard[]; topicCounts: Record<string, number>; formatCounts: Record<string, number> }> {
  const r = (await ctx.db.query(`select * from reference_accounts where id = $1 and owner_user_id = $2 and org_id = $3`, [id, ctx.uid, ctx.orgId])).rows[0];
  if (!r) notFound();
  const ids = (await ctx.db.query<{ id: string }>(
    `select id from notes where org_id = $1 and data_mode = $2 and author_ref = $3 and not is_fallback order by published_at desc nulls last limit 30`, [ctx.orgId, r.data_mode, r.provider_user_id],
  )).rows.map((x) => x.id);
  const notes = await getNotes(ctx, ids);
  const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  return { account: toAccount(r), notes, topicCounts: count(notes.flatMap((n) => n.topics)), formatCounts: count(notes.flatMap((n) => n.formats)) };
}

export async function deleteReferenceAccount(ctx: Ctx, id: string): Promise<void> {
  const r = await ctx.db.query(`delete from reference_accounts where id = $1 and owner_user_id = $2`, [id, ctx.uid]);
  if (!r.rowCount) notFound();
}

export async function compareReferenceAccounts(ctx: Ctx, ids: string[]): Promise<ReferenceAccount[]> {
  if (ids.length > 3) throw new AppError('VALIDATION_FAILED', '최대 3개까지 비교할 수 있습니다.');
  const all = await listReferenceAccounts(ctx);
  return ids.map((id) => all.find((a) => a.id === id)).filter((a): a is ReferenceAccount => !!a);
}
