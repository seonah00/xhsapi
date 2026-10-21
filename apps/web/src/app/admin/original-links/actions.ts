'use server';
import { redirect } from 'next/navigation';
import { recoverStoredNoteLinks, RecoveryInput } from '@xhs/core';
import { service } from '@/server/ctx';
import { env } from '@/server/env';
import { orRedirectWithError } from '@/server/actions-util';
import { withAdmin } from '../forbidden-guard';

export async function recoverLinks(f:FormData) {
  const result=await orRedirectWithError('/admin/original-links',()=>withAdmin(async ctx=>{
    const scope=RecoveryInput.parse({source:f.get('source'),offset:f.get('offset')});
    return {source:scope.source,...await recoverStoredNoteLinks(ctx,service,scope,env().APIFY_TOKEN)};
  }));
  const query=new URLSearchParams(Object.entries(result).map(([k,v])=>[k,String(v??'')]));
  redirect(`/admin/original-links?${query}`);
}
