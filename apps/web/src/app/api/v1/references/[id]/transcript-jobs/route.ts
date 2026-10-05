import { z } from 'zod';
import { assertTranscriptAllowed, reserveJob } from '@xhs/core';
import { api, idempotencyKey, jsonBody } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

/** F15: video note, owner, limits and quote checked server-side; returns 202 + jobId. */
export const POST = api<{ id: string }>(async (req, { id }) => {
  const refId = z.string().uuid().parse(id);
  const key = idempotencyKey(req);
  const { approvedQuoteId, consent } = z.object({ approvedQuoteId: z.string().uuid(), consent: z.boolean().optional() }).parse(await jsonBody(req));
  return withApiCtx(async (ctx) => {
    const replay = (await ctx.db.query(`select resource_id from idempotency_keys where org_id = $1 and owner_user_id = $2 and route = $3 and key = $4`, [ctx.orgId, ctx.uid, 'POST /references/:id/transcript-jobs', key])).rows[0];
    if (replay) return { jobId: replay.resource_id, replayed: true };
    const { noteId } = await assertTranscriptAllowed(ctx, refId);
    const scope = { referenceId: refId, noteId };
    return reserveJob(ctx, { quoteId: approvedQuoteId, route: 'POST /references/:id/transcript-jobs', idempotencyKey: key, operation: 'transcript_submit', scope, jobKind: 'transcript_submit', dedupeKey: `transcript_submit:${approvedQuoteId}`, inputRef: scope, consent: consent === true });
  });
}, { status: 202 });
