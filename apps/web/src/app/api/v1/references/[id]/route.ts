import { z } from 'zod';
import { getReference, trashReference, updateReference } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

const uuid = z.string().uuid();
export const GET = api<{ id: string }>(async (_r, { id }) => withApiCtx((ctx) => getReference(ctx, uuid.parse(id))));
export const PATCH = api<{ id: string }>(async (req, { id }) => { const body = await jsonBody(req); return withApiCtx(async (ctx) => ({ revision: await updateReference(ctx, uuid.parse(id), body) })); });
export const DELETE = api<{ id: string }>(async (_r, { id }) => withApiCtx(async (ctx) => { await trashReference(ctx, uuid.parse(id), true); return { trashed: true }; }));
