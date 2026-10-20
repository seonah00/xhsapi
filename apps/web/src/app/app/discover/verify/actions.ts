'use server';
import { redirect } from 'next/navigation';
import { verifyKeywordCandidates } from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { env } from '@/server/env';
import { orRedirectWithError } from '@/server/actions-util';
export async function verifyCandidates(form:FormData) {
  const ids=await orRedirectWithError('/app/discover',()=>withPageCtx(ctx=>verifyKeywordCandidates(ctx,service,{
    source:JSON.parse(String(form.get('source')??'{}')),terms:form.getAll('term'),
  },env())));
  redirect(`/app/discover/verify?ids=${ids.join(',')}`);
}
