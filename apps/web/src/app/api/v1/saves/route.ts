import { z } from 'zod';
import { toggleSave } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

const Body = z.object({ type: z.enum(['note', 'keyword', 'expression']), id: z.string().uuid() });
export const POST = api(async (req) => { const b = Body.parse(await jsonBody(req)); return withApiCtx(async (ctx) => ({ saved: await toggleSave(ctx, b.type, b.id) })); });
