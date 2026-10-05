import { z } from 'zod';
import { getPlan, saveVersion } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

const uuid = z.string().uuid();
export const GET = api<{ id: string }>(async (_r, { id }) => withApiCtx(async (ctx) => (await getPlan(ctx, uuid.parse(id))).versions));
export const POST = api<{ id: string }>(async (req, { id }) => {
  const b = z.object({ revision: z.number().int() }).parse(await jsonBody(req));
  return withApiCtx(async (ctx) => { const v = await saveVersion(ctx, uuid.parse(id), b.revision); return { id: v.id, version: v.version }; });
}, { status: 201 });
