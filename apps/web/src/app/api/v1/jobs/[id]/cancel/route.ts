import { z } from 'zod';
import { cancelJob } from '@xhs/core';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

/** Cancels a queued job (owner or org admin). Work already sent to a provider is not guaranteed to stop. */
export const POST = api<{ id: string }>(async (_r, { id }) => withApiCtx(async (ctx) => { await cancelJob(ctx, z.string().uuid().parse(id)); return { cancelled: true }; }));
