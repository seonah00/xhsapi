'use server';

import { publishDictionaryImport, reviewDictionaryImport } from '@xhs/core';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orRedirectWithError } from '@/server/actions-util';
import { withAdmin } from '../../forbidden-guard';

const Id = z.string().uuid();

export async function completeDictionaryReview(form: FormData) {
  const id = Id.parse(form.get('id'));
  await orRedirectWithError(`/admin/dictionary/${id}`, () => withAdmin((ctx) => reviewDictionaryImport(ctx, id, form.get('confirmed') === 'on')));
  redirect(`/admin/dictionary/${id}?reviewed=1`);
}

export async function publishDictionary(form: FormData) {
  const id = Id.parse(form.get('id'));
  await orRedirectWithError(`/admin/dictionary/${id}`, () => withAdmin((ctx) => publishDictionaryImport(ctx, id, form.get('confirmed') === 'on')));
  redirect(`/admin/dictionary/${id}?published=1`);
}
