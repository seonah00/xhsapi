import { z } from 'zod';
import { assertTranscriptAllowed, createQuote, getReference } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { service, withApiCtx } from '@/server/ctx';

const Body = z.object({ operation: z.enum(['reference_analysis', 'transcript_submit']), referenceId: z.string().uuid() });

/** Server-generated single-use quote (5 min). Scope is derived on the server, never taken from the client. */
export const POST = api(async (req) => {
  const b = Body.parse(await jsonBody(req));
  return withApiCtx(async (ctx) => {
    if (b.operation === 'transcript_submit') {
      const { noteId } = await assertTranscriptAllowed(ctx, b.referenceId);
      return createQuote(ctx, service, b.operation, { referenceId: b.referenceId, noteId });
    }
    await getReference(ctx, b.referenceId);
    return createQuote(ctx, service, b.operation, { referenceId: b.referenceId });
  });
}, { status: 201 });
