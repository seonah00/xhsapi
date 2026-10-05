import { createReference, listReferences } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const GET = api(async (req) => withApiCtx((ctx) => listReferences(ctx, Object.fromEntries(req.nextUrl.searchParams))));
export const POST = api(async (req) => { const body = await jsonBody(req); return withApiCtx(async (ctx) => ({ id: await createReference(ctx, body) })); }, { status: 201 });
