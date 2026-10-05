'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { addSnapshot, createPublication, createQuote, deletePublication, METRIC_KEYS, reserveJob } from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';

const toIso = (v: FormDataEntryValue | null) => { const s = String(v ?? ''); return s ? new Date(s).toISOString() : undefined; };

export async function addPublication(f: FormData) {
  const id = await orRedirectWithError('/app/results', () => withPageCtx((ctx) => createPublication(ctx, {
    accountId: String(f.get('accountId')), planVersionId: String(f.get('planVersionId') ?? '') || undefined, noteUrl: String(f.get('noteUrl') ?? '').trim() || undefined,
    publishedAt: toIso(f.get('publishedAt')), title: String(f.get('title') ?? '').trim() || undefined, topic: String(f.get('topic') ?? '') || undefined,
    format: String(f.get('format') ?? '') || undefined, sponsorship: String(f.get('sponsorship') ?? 'unknown'), paidPromotion: String(f.get('paidPromotion') ?? 'unknown'),
  })));
  redirect(`/app/results/${id}`);
}

export async function addResult(f: FormData) {
  const id = z.string().uuid().parse(f.get('publicationId'));
  const metrics = Object.fromEntries(METRIC_KEYS.map((k) => { const v = String(f.get(k) ?? '').trim(); return [k, v === '' ? null : Number(v)]; }));
  await orRedirectWithError(`/app/results/${id}`, () => withPageCtx((ctx) => addSnapshot(ctx, id, { observedAt: toIso(f.get('observedAt')), source: String(f.get('source') ?? 'manual'), metrics })));
  redirect(`/app/results/${id}?added=1`);
}

export async function removePublication(f: FormData) {
  const id = z.string().uuid().parse(f.get('publicationId'));
  await orRedirectWithError(`/app/results/${id}`, () => withPageCtx((ctx) => deletePublication(ctx, id)));
  redirect('/app/results');
}

export async function quoteReflection(f: FormData) {
  const accountId = z.string().uuid().parse(f.get('accountId'));
  const ids = f.getAll('snapshotIds').map(String);
  const back = `/app/results?account=${accountId}`;
  if (ids.length === 0) redirect(`${back}&error=${encodeURIComponent('회고에 쓸 게시물을 하나 이상 고르세요.')}`);
  const q = await orRedirectWithError(back, () => withPageCtx((ctx) => createQuote(ctx, service, 'results_reflection', { accountId, snapshotIds: ids.join(',') })));
  redirect(`${back}&confirm=1&quote=${q.id}&ids=${ids.join(',')}#reflect`);
}

export async function confirmReflection(f: FormData) {
  const accountId = z.string().uuid().parse(f.get('accountId'));
  const ids = String(f.get('ids') ?? '').split(',').filter(Boolean);
  const quoteId = z.string().uuid().parse(f.get('quoteId'));
  const back = `/app/results?account=${accountId}`;
  const scope = { accountId, snapshotIds: ids.join(',') };
  const { jobId } = await orRedirectWithError(back, () => withPageCtx((ctx) => reserveJob(ctx, {
    quoteId, route: 'POST /results/reflections', idempotencyKey: z.string().uuid().parse(f.get('idem')), operation: 'results_reflection', scope,
    jobKind: 'results_reflection', dedupeKey: `results_reflection:${quoteId}`, inputRef: { accountId, snapshotIds: ids },
  })));
  redirect(`${back}&job=${jobId}#reflect`);
}
