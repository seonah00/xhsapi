import { AppError, checkInputHash, contentHash, PlanStatus, type CheckSections } from '@xhs/domain';
import { z } from 'zod';
import { notFound, type Ctx } from './context.ts';
import { getAccount } from './accounts.ts';

/** Spec F08 fact sheet: confirmed vs unknown facts are separate; optional fields stay empty unless the student fills them. */
export const FactSheet = z.object({
  subject: z.string().trim().max(200).default(''),
  confirmedFacts: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  unknownFacts: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  shootableScenes: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  shootingConditions: z.string().trim().max(300).default(''),
  sponsorship: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  usagePeriod: z.string().trim().max(100).optional(),
  visitDate: z.string().trim().max(40).optional(),
  price: z.string().trim().max(60).optional(),
  results: z.string().trim().max(300).optional(),
});
export type FactSheet = z.infer<typeof FactSheet>;

export const Shot = z.object({ scene: z.string().trim().max(200), note: z.string().trim().max(200).default('') });

export const PlanContent = z.object({
  intent: z.string().max(500).default(''),
  title: z.string().max(100).default(''),
  cover: z.string().max(100).default(''),
  body: z.string().max(10_000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  subtitles: z.string().max(5_000).default(''),
  shots: z.array(Shot).max(30).default([]),
  meaningKo: z.string().max(5_000).default(''),
});
export type PlanContent = z.infer<typeof PlanContent>;

export const PlanDraft = z.object({ content: PlanContent.default({}), facts: FactSheet.default({}) });
export type PlanDraft = z.infer<typeof PlanDraft>;

export function sectionsOf(c: PlanContent): CheckSections {
  return { title: c.title, cover: c.cover, body: c.body, tags: c.tags, subtitles: c.subtitles };
}
export function versionCheckHash(content: PlanContent, facts: FactSheet): string {
  return checkInputHash(sectionsOf(content), facts, facts.sponsorship);
}

export type PlanSummary = { id: string; title: string; status: string; accountId: string; accountName: string; updatedAt: string; currentVersion: number | null };
export type PlanVersion = {
  id: string; version: number; kind: 'edit' | 'ai_proposal'; content: PlanContent; facts: FactSheet; sourceRefs: string[];
  contentHash: string; checkInputHash: string; createdAt: string; profileVersionId: string | null;
};
export type PlanDetail = PlanSummary & { revision: number; draft: PlanDraft; draftUpdatedAt: string | null; currentVersionId: string | null; versions: PlanVersion[]; draftHash: string };

export const PlanCreate = z.object({
  accountId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  referenceIds: z.array(z.string().uuid()).max(5).default([]),
  subject: z.string().trim().max(200).optional(),
  seedText: z.string().trim().max(200).optional(),
});

export async function listPlans(ctx: Ctx): Promise<PlanSummary[]> {
  return (await ctx.db.query(
    `select p.id, p.title, p.status, p.account_id, a.display_name, p.updated_at, v.version
     from plans p join creator_accounts a on a.id = p.account_id left join plan_versions v on v.id = p.current_version_id
     where p.org_id = $1 and p.owner_user_id = $2 and p.deleted_at is null order by p.updated_at desc`, [ctx.orgId, ctx.uid],
  )).rows.map((r) => ({ id: r.id, title: r.title, status: r.status, accountId: r.account_id, accountName: r.display_name, updatedAt: r.updated_at.toISOString(), currentVersion: r.version }));
}

async function insertVersion(ctx: Ctx, planId: string, kind: 'edit' | 'ai_proposal', draft: PlanDraft, sourceRefs: string[], profileVersionId: string | null, jobId: string | null = null): Promise<PlanVersion> {
  const next = (await ctx.db.query<{ n: number }>(`select coalesce(max(version), 0) + 1 as n from plan_versions where plan_id = $1`, [planId])).rows[0]!.n;
  const r = (await ctx.db.query(
    `insert into plan_versions (org_id, plan_id, version, kind, profile_version_id, fact_sheet_json, content_json, source_refs, content_hash, check_input_hash, created_by, generation_job_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id, created_at`,
    [ctx.orgId, planId, next, kind, profileVersionId, draft.facts, draft.content, JSON.stringify(sourceRefs),
     contentHash({ content: draft.content, facts: draft.facts, kind }), versionCheckHash(draft.content, draft.facts), ctx.uid, jobId],
  )).rows[0];
  return { id: r.id, version: next, kind, content: draft.content, facts: draft.facts, sourceRefs, contentHash: contentHash({ content: draft.content, facts: draft.facts, kind }), checkInputHash: versionCheckHash(draft.content, draft.facts), createdAt: r.created_at.toISOString(), profileVersionId };
}

/** Starts a plan from a new subject, saved references (1–5) or a keyword/expression seed (spec F08). */
export async function createPlan(ctx: Ctx, input: unknown): Promise<string> {
  const d = PlanCreate.parse(input);
  const account = await getAccount(ctx, d.accountId);
  if (d.referenceIds.length) {
    const owned = await ctx.db.query(`select id from reference_items where id = any($1::uuid[]) and owner_user_id = $2 and deleted_at is null`, [d.referenceIds, ctx.uid]);
    if (owned.rowCount !== new Set(d.referenceIds).size) notFound();
  }
  const profileVersionId = (await ctx.db.query<{ v: string }>(`select current_profile_version_id as v from creator_accounts where id = $1`, [account.id])).rows[0]!.v;
  const draft = PlanDraft.parse({ content: { title: '', tags: d.seedText ? [d.seedText] : [] }, facts: { subject: d.subject ?? '' } });
  const planId = (await ctx.db.query<{ id: string }>(
    `insert into plans (org_id, owner_user_id, account_id, title, draft_json, draft_updated_at) values ($1, $2, $3, $4, $5, now()) returning id`,
    [ctx.orgId, ctx.uid, account.id, d.title, { ...draft, sourceRefs: d.referenceIds }],
  )).rows[0]!.id;
  const v = await insertVersion(ctx, planId, 'edit', draft, d.referenceIds, profileVersionId);
  await ctx.db.query(`update plans set current_version_id = $1 where id = $2`, [v.id, planId]);
  return planId;
}

function rowToVersion(r: Record<string, any>): PlanVersion {
  return {
    id: r.id, version: r.version, kind: r.kind, content: PlanContent.parse(r.content_json), facts: FactSheet.parse(r.fact_sheet_json),
    sourceRefs: r.source_refs ?? [], contentHash: r.content_hash, checkInputHash: r.check_input_hash, createdAt: r.created_at.toISOString(), profileVersionId: r.profile_version_id,
  };
}

export async function getPlan(ctx: Ctx, id: string): Promise<PlanDetail> {
  const p = (await ctx.db.query(
    `select p.*, a.display_name from plans p join creator_accounts a on a.id = p.account_id
     where p.id = $1 and p.org_id = $2 and p.owner_user_id = $3 and p.deleted_at is null`, [id, ctx.orgId, ctx.uid],
  )).rows[0];
  if (!p) notFound();
  const versions = (await ctx.db.query(`select * from plan_versions where plan_id = $1 order by version desc`, [id])).rows.map(rowToVersion);
  const draft = PlanDraft.parse(p.draft_json);
  const current = versions.find((v) => v.id === p.current_version_id);
  return {
    id: p.id, title: p.title, status: p.status, accountId: p.account_id, accountName: p.display_name, updatedAt: p.updated_at.toISOString(),
    currentVersion: current?.version ?? null, revision: p.revision, draft, draftUpdatedAt: p.draft_updated_at?.toISOString() ?? null,
    currentVersionId: p.current_version_id, versions, draftHash: versionCheckHash(draft.content, draft.facts),
  };
}

const STALE = () => new AppError('STALE_REVISION', '다른 창이나 기기에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.');

/** Autosave of the working draft (debounced 1s on the client). Stale revision → 409. */
export async function saveDraft(ctx: Ctx, id: string, input: unknown, revision: number): Promise<{ revision: number; draftHash: string }> {
  const draft = PlanDraft.parse(input);
  const r = await ctx.db.query<{ revision: number }>(
    `update plans set draft_json = $3::jsonb || jsonb_build_object('sourceRefs', coalesce(draft_json->'sourceRefs', '[]'::jsonb)), draft_updated_at = now(), revision = revision + 1
     where id = $1 and owner_user_id = $2 and revision = $4 and deleted_at is null returning revision`,
    [id, ctx.uid, draft, revision],
  );
  if (r.rowCount !== 1) { await getPlan(ctx, id); throw STALE(); }
  return { revision: r.rows[0]!.revision, draftHash: versionCheckHash(draft.content, draft.facts) };
}

/** Freezes the current draft into an immutable edit version (checks and submissions use versions). */
export async function saveVersion(ctx: Ctx, id: string, revision: number): Promise<PlanVersion> {
  const plan = await getPlan(ctx, id);
  if (plan.revision !== revision) throw STALE();
  const latest = plan.versions.find((v) => v.kind === 'edit');
  if (latest && latest.checkInputHash === plan.draftHash && contentHash(latest.content) === contentHash(plan.draft.content)) return latest;
  const profileVersionId = (await ctx.db.query<{ v: string }>(`select current_profile_version_id as v from creator_accounts where id = $1`, [plan.accountId])).rows[0]!.v;
  const v = await insertVersion(ctx, id, 'edit', plan.draft, latest?.sourceRefs ?? [], profileVersionId);
  await ctx.db.query(`update plans set current_version_id = $1, revision = revision + 1 where id = $2`, [v.id, id]);
  return v;
}

/** Student-controlled status; checks or feedback never set ready/published (spec F08). */
export async function setPlanStatus(ctx: Ctx, id: string, status: string): Promise<void> {
  const s = PlanStatus.parse(status);
  const r = await ctx.db.query(`update plans set status = $3 where id = $1 and owner_user_id = $2 and deleted_at is null`, [id, ctx.uid, s]);
  if (!r.rowCount) notFound();
}

export async function archivePlan(ctx: Ctx, id: string): Promise<void> {
  const r = await ctx.db.query(`update plans set deleted_at = now() where id = $1 and owner_user_id = $2 and deleted_at is null`, [id, ctx.uid]);
  if (!r.rowCount) notFound();
}

/** Applying an AI proposal is explicit: it replaces the draft and freezes a new edit version (spec F08). */
export async function applyProposal(ctx: Ctx, planId: string, proposalVersionId: string, revision: number): Promise<PlanVersion> {
  const plan = await getPlan(ctx, planId);
  if (plan.revision !== revision) throw STALE();
  const proposal = plan.versions.find((v) => v.id === proposalVersionId && v.kind === 'ai_proposal');
  if (!proposal) notFound();
  if(contentHash(proposal.facts)!==contentHash(plan.draft.facts)) throw new AppError('STALE_REVISION','제안 생성 후 사실 입력이 달라졌습니다. 현재 사실로 다시 제안을 생성하세요.');
  const draft: PlanDraft = { content: proposal.content, facts: plan.draft.facts };
  await saveDraft(ctx, planId, draft, revision);
  return saveVersion(ctx, planId, revision + 1);
}

export async function getVersion(ctx: Ctx, planId: string, versionId: string): Promise<PlanVersion> {
  const r = (await ctx.db.query(`select v.* from plan_versions v join plans p on p.id = v.plan_id where v.id = $1 and v.plan_id = $2 and p.owner_user_id = $3`, [versionId, planId, ctx.uid])).rows[0];
  if (!r) notFound();
  return rowToVersion(r);
}

/** Worker-side (service role) insert of an AI proposal version for the plan owner. Never touches the draft. */
export async function insertProposalVersion(db: import('./context.ts').Db, a: { orgId: string; planId: string; ownerId: string; content: PlanContent; facts: FactSheet; sourceRefs: string[]; profileVersionId: string | null; jobId: string }): Promise<string> {
  const next = (await db.query<{ n: number }>(`select coalesce(max(version), 0) + 1 as n from plan_versions where plan_id = $1`, [a.planId])).rows[0]!.n;
  return (await db.query<{ id: string }>(
    `insert into plan_versions (org_id, plan_id, version, kind, profile_version_id, fact_sheet_json, content_json, source_refs, content_hash, check_input_hash, created_by, generation_job_id)
     values ($1, $2, $3, 'ai_proposal', $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [a.orgId, a.planId, next, a.profileVersionId, a.facts, a.content, JSON.stringify(a.sourceRefs),
     contentHash({ content: a.content, facts: a.facts, kind: 'ai_proposal' }), versionCheckHash(a.content, a.facts), a.ownerId, a.jobId],
  )).rows[0]!.id;
}

export type GenerationRecord = { id: string; createdAt: string; output: import('./generation.ts').GenerationOutput; proposalVersionId: string | null };

export async function listGenerations(ctx: Ctx, planId: string): Promise<GenerationRecord[]> {
  return (await ctx.db.query(
    `select a.id, a.created_at, a.output_json, a.target_id from analyses a
     where a.org_id = $1 and a.owner_user_id = $2 and a.target_type = 'plan_version' and a.schema_version = 'plan-generation-v1'
       and a.output_json ->> 'planId' = $3::text order by a.created_at desc limit 10`, [ctx.orgId, ctx.uid, planId],
  )).rows.map((r) => ({ id: r.id, createdAt: r.created_at.toISOString(), output: r.output_json.output, proposalVersionId: r.output_json.output.kind === 'proposal' ? r.target_id : null }));
}

/** Restores an older version into the working draft (the version itself stays immutable). */
export async function restoreVersion(ctx: Ctx, planId: string, versionId: string, revision: number): Promise<number> {
  const v = await getVersion(ctx, planId, versionId);
  return (await saveDraft(ctx, planId, { content: v.content, facts: v.facts }, revision)).revision;
}
