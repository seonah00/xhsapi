'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createQuote, reserveJob } from '@xhs/core';
import { service } from '@/server/ctx';
import { withAdmin } from '@/app/admin/forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';

export async function quoteEnrichment(f: FormData) {
  const noteId = z.string().uuid().parse(f.get('noteId'));
  const back = `/app/notes/${noteId}/enrich`;
  const q = await orRedirectWithError(back,()=>withAdmin(ctx=>createQuote(ctx,service,'note_enrichment',{noteId})));
  redirect(`${back}?quote=${q.id}`);
}
export async function confirmEnrichment(f: FormData) {
  const noteId=z.string().uuid().parse(f.get('noteId'));
  const quoteId=z.string().uuid().parse(f.get('quoteId'));
  const back=`/app/notes/${noteId}/enrich`;
  const result=await orRedirectWithError(back,()=>withAdmin(ctx=>reserveJob(ctx,{
    quoteId,route:'POST /notes/enrich',idempotencyKey:z.string().uuid().parse(f.get('idem')),
    operation:'note_enrichment',scope:{noteId},jobKind:'note_enrichment',dedupeKey:`note_enrichment:${quoteId}`,inputRef:{noteId},consent:f.get('consent')==='on',
  })));
  redirect(`${back}?job=${result.jobId}`);
}
