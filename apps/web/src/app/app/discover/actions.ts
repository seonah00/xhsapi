'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createQuote, createReference, reserveJob, toggleSave } from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { orRedirectWithError, safeLocalPath } from '@/server/actions-util';

const COMPARE = 'xhs_compare';
const id = z.string().uuid();
const back = (f: FormData) => { const b = safeLocalPath(f.get('back'), '/app'); return b === '/app' ? '/app/discover' : b; };

export async function toggleSaveNote(f: FormData) {
  await orRedirectWithError(back(f), () => withPageCtx((ctx) => toggleSave(ctx, 'note', id.parse(f.get('noteId')))));
  revalidatePath('/app', 'layout');
  redirect(back(f));
}

export async function useAsReference(f: FormData) {
  const refId = await orRedirectWithError(back(f), () => withPageCtx((ctx) => createReference(ctx, { sourceType: 'saved_note', noteId: id.parse(f.get('noteId')) })));
  redirect(`/app/references/${refId}`);
}

export async function getCompareIds(): Promise<string[]> {
  const raw = (await cookies()).get(COMPARE)?.value ?? '';
  return raw.split(',').filter((x) => id.safeParse(x).success).slice(0, 3);
}

/** Compare list lives in a cookie (max 3). Comparing never triggers AI or provider calls. */
export async function toggleCompare(f: FormData) {
  const noteId = id.parse(f.get('noteId'));
  const ids = await getCompareIds();
  const next = ids.includes(noteId) ? ids.filter((x) => x !== noteId) : [...ids, noteId].slice(-3);
  (await cookies()).set(COMPARE, next.join(','), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
  redirect(back(f));
}

export async function clearCompare() {
  (await cookies()).delete(COMPARE);
  redirect('/app/discover/compare');
}

const RefreshScope = z.object({ query: z.string().trim().min(1, '검색어를 입력하세요.').max(50), topic: z.string().max(40).optional(), days: z.enum(['7', '14', '30']).optional() });
const refreshScope = (f: FormData) => {
  const s = RefreshScope.parse({ query: String(f.get('q') ?? ''), topic: String(f.get('topic') ?? '') || undefined, days: String(f.get('days') ?? '') || undefined });
  return { query: s.query, ...(s.topic ? { topic: s.topic } : {}), ...(s.days ? { days: s.days } : {}) };
};

/** "외부 자료 새로 조회": quote first (spec F04 step 3). In mock mode the provider returns synthetic fixtures only. */
export async function quoteRefresh(f: FormData) {
  const scope = await orRedirectWithError(back(f), async () => refreshScope(f));
  const q = await orRedirectWithError(back(f), () => withPageCtx((ctx) => createQuote(ctx, service, 'provider_search', scope)));
  const qs = new URLSearchParams({ ...scope, q: scope.query, refresh: '1', quote: q.id });
  qs.delete('query');
  redirect(`/app/discover?${qs}#refresh`);
}

export async function confirmRefresh(f: FormData) {
  const scope = await orRedirectWithError(back(f), async () => refreshScope(f));
  const quoteId = id.parse(f.get('quoteId'));
  const { jobId } = await orRedirectWithError(back(f), () => withPageCtx((ctx) => reserveJob(ctx, {
    quoteId, route: 'POST /discover/refresh', idempotencyKey: id.parse(f.get('idem')), operation: 'provider_search', scope,
    jobKind: 'provider_search', dedupeKey: `provider_search:${quoteId}`, inputRef: { query: scope.query, ...(scope.topic ? { topic: scope.topic } : {}), ...(scope.days ? { days: Number(scope.days) } : {}) },
  })));
  const qs = new URLSearchParams({ q: scope.query, ...(scope.topic ? { topic: scope.topic } : {}), ...(scope.days ? { days: scope.days } : {}), job: jobId });
  redirect(`/app/discover?${qs}#refresh`);
}
