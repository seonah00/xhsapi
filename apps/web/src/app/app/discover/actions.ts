'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createReference, toggleSave } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';

const COMPARE = 'xhs_compare';
const id = z.string().uuid();
const back = (f: FormData) => { const b = String(f.get('back') ?? '/app/discover'); return b.startsWith('/app') ? b : '/app/discover'; };

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
