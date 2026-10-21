'use server';
import { redirect } from 'next/navigation';
import { requestNoteLinkRecovery, RecoveryInput } from '@xhs/core';
import { service } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { withAdmin } from '../forbidden-guard';

export async function recoverLinks(f:FormData) {
  const result=await orRedirectWithError('/admin/original-links',()=>withAdmin(async ctx=>{
    const scope=RecoveryInput.parse({source:f.get('source'),offset:f.get('offset')});
    return requestNoteLinkRecovery(ctx,service,scope);
  }));
  redirect(`/admin/original-links?job=${result}`);
}
