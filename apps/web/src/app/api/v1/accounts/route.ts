import { createAccount, listAccounts } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const GET = api(async () => withApiCtx((ctx) => listAccounts(ctx)));
export const POST = api(async (req) => { const body = await jsonBody(req); return withApiCtx(async (ctx) => ({ id: await createAccount(ctx, body) })); }, { status: 201 });
