import { z } from 'zod';
import { saveDraft } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

/** Autosave endpoint (debounced client-side). Stale revision → 409. */
export const PATCH = api<{ id: string }>(async (req, { id }) => {
  const b = z.object({ draft: z.unknown(), revision: z.number().int() }).parse(await jsonBody(req));
  return withApiCtx((ctx) => saveDraft(ctx, z.string().uuid().parse(id), b.draft, b.revision));
});
