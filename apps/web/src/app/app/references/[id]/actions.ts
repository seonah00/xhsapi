'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  assertTranscriptAllowed, createQuote, deleteTranscript, reserveJob, trashReference, updateReference,
} from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';

const uuid = z.string().uuid();
const refPath = (id: string) => `/app/references/${id}`;

export async function saveMeta(f: FormData) {
  const id = uuid.parse(f.get('id'));
  await orRedirectWithError(refPath(id), () => withPageCtx((ctx) => updateReference(ctx, id, {
    title: String(f.get('title') ?? '').trim() || null,
    memo: String(f.get('memo') ?? '') || null,
    tags: String(f.get('tags') ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    favorite: f.get('favorite') === 'on',
    collectionId: String(f.get('collectionId') ?? '') || null,
    revision: Number(f.get('revision')),
  })));
  redirect(`${refPath(id)}?saved=1`);
}

export async function setTrashed(f: FormData) {
  const id = uuid.parse(f.get('id'));
  const trashed = f.get('trashed') === '1';
  await orRedirectWithError(refPath(id), () => withPageCtx((ctx) => trashReference(ctx, id, trashed)));
  redirect(trashed ? '/app/references?trash=1' : refPath(id));
}

/** Step 1 of a paid-style action: server quote with limits, shown for confirmation. */
export async function quoteAnalysis(f: FormData) {
  const id = uuid.parse(f.get('id'));
  const q = await orRedirectWithError(refPath(id), () => withPageCtx((ctx) => createQuote(ctx, service, 'reference_analysis', { referenceId: id })));
  redirect(`${refPath(id)}?confirm=analysis&quote=${q.id}`);
}

export async function confirmAnalysis(f: FormData) {
  const id = uuid.parse(f.get('id'));
  const scope = { referenceId: id };
  const quoteId = uuid.parse(f.get('quoteId'));
  const { jobId } = await orRedirectWithError(refPath(id), () => withPageCtx((ctx) => reserveJob(ctx, {
    quoteId, route: 'POST /references/:id/analyses', idempotencyKey: uuid.parse(f.get('idem')), operation: 'reference_analysis', scope,
    consent: f.get('consent') === 'on', jobKind: 'reference_analysis', dedupeKey: `reference_analysis:${quoteId}`, inputRef: scope,
  })));
  redirect(`${refPath(id)}?job=${jobId}`);
}

export async function quoteTranscript(f: FormData) {
  const id = uuid.parse(f.get('id'));
  const back = `${refPath(id)}/transcript`;
  const q = await orRedirectWithError(back, () => withPageCtx(async (ctx) => {
    const { noteId } = await assertTranscriptAllowed(ctx, id);
    return createQuote(ctx, service, 'transcript_submit', { referenceId: id, noteId });
  }));
  redirect(`${back}?confirm=1&quote=${q.id}`);
}

export async function confirmTranscript(f: FormData) {
  const id = uuid.parse(f.get('id'));
  const back = `${refPath(id)}/transcript`;
  const quoteId = uuid.parse(f.get('quoteId'));
  const { jobId } = await orRedirectWithError(back, () => withPageCtx(async (ctx) => {
    const { noteId } = await assertTranscriptAllowed(ctx, id);
    const scope = { referenceId: id, noteId };
    return reserveJob(ctx, {
      quoteId, route: 'POST /references/:id/transcript-jobs', idempotencyKey: uuid.parse(f.get('idem')), operation: 'transcript_submit', scope,
      jobKind: 'transcript_submit', dedupeKey: `transcript_submit:${quoteId}`, inputRef: scope, consent: f.get('consent') === 'on',
    });
  }));
  redirect(`${back}?job=${jobId}`);
}

export async function removeTranscript(f: FormData) {
  const id = uuid.parse(f.get('id'));
  const back = `${refPath(id)}/transcript`;
  await orRedirectWithError(back, () => withPageCtx((ctx) => deleteTranscript(ctx, id)));
  redirect(`${back}?deleted=1`);
}
