import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const GET = api(async (req) => withApiCtx(async (ctx) => {
  const kind = req.nextUrl.searchParams.get('kind');
  return (await ctx.db.query(
    `select kind, slug, label_ko, label_zh, provenance from taxonomy_terms where active and (org_id is null or org_id = $1) and ($2::text is null or kind = $2) order by kind, slug`,
    [ctx.orgId, kind],
  )).rows;
}));
