'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deleteReferenceAccount, saveReferenceAccount } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';

export async function saveAccount(f: FormData) {
  const authorRef = z.string().min(1).max(200).parse(f.get('authorRef'));
  const id = await orRedirectWithError('/app/reference-accounts', () => withPageCtx((ctx) => saveReferenceAccount(ctx, authorRef)));
  redirect(`/app/reference-accounts/${id}`);
}

export async function removeAccount(f: FormData) {
  const id = z.string().uuid().parse(f.get('id'));
  await orRedirectWithError(`/app/reference-accounts/${id}`, () => withPageCtx((ctx) => deleteReferenceAccount(ctx, id)));
  redirect('/app/reference-accounts');
}
