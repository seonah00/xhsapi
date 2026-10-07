'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { EnrichmentScope } from '@xhs/domain';
import { createQuote, reserveJob } from '@xhs/core';
import { service } from '@/server/ctx';
import { withAdmin } from '@/app/admin/forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';

const scopeOf = (f: FormData) => EnrichmentScope.parse({ noteIds: String(f.get('ids') ?? '').split(',') });
export async function quoteCovers(f: FormData) {
  const scope = scopeOf(f);
  const back = `/app/notes/enrich?ids=${String(f.get('ids'))}`;
  const q = await orRedirectWithError(back, () => withAdmin(ctx => createQuote(ctx, service, 'note_enrichment', scope)));
  redirect(`${back}&quote=${q.id}`);
}
export async function confirmCovers(f: FormData) {
  const scope = scopeOf(f);
  const quoteId = z.string().uuid().parse(f.get('quoteId'));
  const back = `/app/notes/enrich?ids=${String(f.get('ids'))}`;
  const result = await orRedirectWithError(back, () => withAdmin(ctx => reserveJob(ctx, {
    quoteId, route: 'POST /notes/enrich-batch', idempotencyKey: z.string().uuid().parse(f.get('idem')),
    operation: 'note_enrichment', scope, jobKind: 'note_enrichment', dedupeKey: `note_enrichment:${quoteId}`,
    inputRef: scope, consent: f.get('consent') === 'on',
  })));
  redirect(`${back}&job=${result.jobId}`);
}
