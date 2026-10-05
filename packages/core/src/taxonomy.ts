import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { notFound, type Ctx } from './context.ts';
import { requireAdmin } from './admin.ts';

export type TaxonomyTerm = { id: string; global: boolean; kind: string; slug: string; labelKo: string; labelZh: string | null; provenance: string; version: number; active: boolean };

export async function listTaxonomy(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<TaxonomyTerm[]> {
  return (await ctx.db.query(
    `select * from taxonomy_terms where (org_id is null or org_id = $1) and ($2 or active) order by kind, org_id nulls first, slug`, [ctx.orgId, !!opts.includeInactive],
  )).rows.map((r) => ({ id: r.id, global: r.org_id === null, kind: r.kind, slug: r.slug, labelKo: r.label_ko, labelZh: r.label_zh, provenance: r.provenance, version: r.version, active: r.active }));
}

export const TermInput = z.object({
  kind: z.enum(['subtopic', 'purpose', 'region', 'search_seed']),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, '영문 소문자·숫자·하이픈'),
  labelKo: z.string().trim().min(1).max(40),
  labelZh: z.string().trim().max(40).optional(),
});

/** Org-specific terms; built-in topics/formats are fixed. Terms are deactivated, never deleted (spec F03). */
export async function createTerm(ctx: Ctx, input: unknown): Promise<string> {
  requireAdmin(ctx);
  const d = TermInput.parse(input);
  try {
    return (await ctx.db.query<{ id: string }>(
      `insert into taxonomy_terms (org_id, kind, slug, label_ko, label_zh, provenance) values ($1, $2, $3, $4, $5, 'editorial_seed') returning id`,
      [ctx.orgId, d.kind, d.slug, d.labelKo, d.labelZh ?? null],
    )).rows[0]!.id;
  } catch (e) {
    if (/duplicate key/.test(String(e))) throw new AppError('CONFLICT', '같은 종류에 같은 슬러그가 이미 있습니다.');
    throw e;
  }
}

export async function setTermActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  requireAdmin(ctx);
  const r = await ctx.db.query(`update taxonomy_terms set active = $3, version = version + 1 where id = $1 and org_id = $2`, [id, ctx.orgId, active]);
  if (!r.rowCount) notFound();
}
