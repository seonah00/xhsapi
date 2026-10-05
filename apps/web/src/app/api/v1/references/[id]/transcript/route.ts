import { z } from 'zod';
import { deleteTranscript, getTranscript } from '@xhs/core';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const GET = api<{ id: string }>(async (_r, { id }) => withApiCtx((ctx) => getTranscript(ctx, z.string().uuid().parse(id))));
export const DELETE = api<{ id: string }>(async (_r, { id }) => withApiCtx(async (ctx) => { await deleteTranscript(ctx, z.string().uuid().parse(id)); return { deleted: true }; }));
