import { z } from 'zod';
import { getAccount, updateAccountProfile } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const GET = api<{ id: string }>(async (_req, { id }) => withApiCtx((ctx) => getAccount(ctx, z.string().uuid().parse(id))));
export const PATCH = api<{ id: string }>(async (req, { id }) => {
  const body = z.object({ profile: z.unknown(), revision: z.number().int() }).parse(await jsonBody(req));
  return withApiCtx(async (ctx) => ({ profileVersion: await updateAccountProfile(ctx, z.string().uuid().parse(id), body.profile, body.revision) }));
});
