
'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { connectOriginalNoteLink } from '@xhs/core';
import { service } from '@/server/ctx';
import { withAdmin } from '@/app/admin/forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
export async function connectOriginal(f: FormData) {
  const id=z.string().uuid().parse(f.get('noteId'));
  const back=`/app/notes/${id}`;
  await orRedirectWithError(back,()=>withAdmin(ctx=>connectOriginalNoteLink(ctx,service,id,f.get('shareUrl'))));
  redirect(`${back}?connected=1`);
}
