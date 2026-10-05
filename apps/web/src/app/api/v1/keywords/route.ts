import { listKeywords } from '@xhs/core';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const GET = api(async (req) => withApiCtx((ctx) => listKeywords(ctx, Object.fromEntries(req.nextUrl.searchParams))));
