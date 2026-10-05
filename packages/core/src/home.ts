import type { Ctx } from './context.ts';
import { listAccounts, type AccountRow } from './accounts.ts';
import { lastFetched, recommend, type Recommendation } from './discover.ts';

export type HomeData = {
  accounts: AccountRow[];
  current: AccountRow | null;
  recommendations: Recommendation[];
  sampleSize: number;
  rankingVersion: string;
  lastFetchedAt: string | null;
  savedExpressions: { id: string; expression: string; meaning: string | null }[];
  activePlans: { id: string; title: string; status: string; updatedAt: string }[];
  feedback: { submissionId: string; status: string; latest: string | null; at: string }[];
};

export async function homeData(ctx: Ctx, accountId: string | null): Promise<HomeData> {
  const accounts = await listAccounts(ctx);
  const current = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
  const rec = current ? await recommend(ctx, current.profile) : { items: [], sampleSize: 0, rankingVersion: '' };
  const savedExpressions = (await ctx.db.query(
    `select e.id, e.expression, e.explanations_json ->> 'meaning' as meaning from personal_saves s join expressions e on e.id = s.target_id
     where s.owner_user_id = $1 and s.target_type = 'expression' order by s.created_at desc limit 5`, [ctx.uid],
  )).rows;
  const activePlans = (await ctx.db.query(
    `select id, title, status, updated_at from plans where org_id = $1 and owner_user_id = $2 and deleted_at is null and status not in ('archived', 'user_marked_published')
     order by updated_at desc limit 5`, [ctx.orgId, ctx.uid],
  )).rows.map((p) => ({ id: p.id, title: p.title, status: p.status, updatedAt: p.updated_at.toISOString() }));
  const feedback = (await ctx.db.query(
    `select s.id, s.status, (select f.content from feedback f where f.submission_id = s.id order by f.created_at desc limit 1) as latest, s.submitted_at
     from submissions s where s.org_id = $1 and s.owner_user_id = $2 and s.status <> 'withdrawn' order by s.submitted_at desc limit 5`, [ctx.orgId, ctx.uid],
  )).rows.map((r) => ({ submissionId: r.id, status: r.status, latest: r.latest, at: r.submitted_at.toISOString() }));
  return {
    accounts, current, recommendations: rec.items, sampleSize: rec.sampleSize, rankingVersion: rec.rankingVersion,
    lastFetchedAt: await lastFetched(ctx), savedExpressions, activePlans, feedback,
  };
}
