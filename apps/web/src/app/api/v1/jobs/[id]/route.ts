import { z } from 'zod';
import { getJob, notFound } from '@xhs/core';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

/** Own jobs only (RLS). No input payloads, raw text or keys are returned. */
export const GET = api<{ id: string }>(async (_r, { id }) => withApiCtx(async (ctx) => (await getJob(ctx, z.string().uuid().parse(id))) ?? notFound()));
