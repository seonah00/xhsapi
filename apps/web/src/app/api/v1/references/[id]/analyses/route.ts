import { z } from 'zod';
import { getReference, reserveJob } from '@xhs/core';
import { api, idempotencyKey, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

export const POST = api<{ id: string }>(async (req, { id }) => {
  const refId = z.string().uuid().parse(id);
  const key = idempotencyKey(req);
  const { approvedQuoteId } = z.object({ approvedQuoteId: z.string().uuid() }).parse(await jsonBody(req));
  return withApiCtx(async (ctx) => {
    await getReference(ctx, refId);
    const scope = { referenceId: refId };
    return reserveJob(ctx, { quoteId: approvedQuoteId, route: 'POST /references/:id/analyses', idempotencyKey: key, operation: 'reference_analysis', scope, jobKind: 'reference_analysis', dedupeKey: `reference_analysis:${approvedQuoteId}`, inputRef: scope });
  });
}, { status: 202 });
