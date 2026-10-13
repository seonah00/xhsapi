'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createQuote, reserveJob, languageScopeFields, LanguageScope, prepareLanguageAi } from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
const root='/app/discover/language';
export async function previewLanguage(f:FormData) {
  const scope=await orRedirectWithError(root,async()=>LanguageScope.parse(f.get('task')==='expand'?{task:'expand',query:String(f.get('query')??''),noteIds:String(f.get('noteIds')??'').split(',').filter(Boolean)}:f.get('task')==='interpret'?{task:'interpret',noteIds:String(f.get('noteIds')??'').split(',').filter(Boolean)}:{task:'translate',query:String(f.get('query')??'')}));
  const quote=await orRedirectWithError(root,()=>withPageCtx(async ctx=>{
    await prepareLanguageAi(ctx,scope);
    return createQuote(ctx,service,'query_expansion',scope);
  }));
  redirect(`${root}?quote=${quote.id}`);
}
export async function confirmLanguage(f:FormData) {
  const job=await orRedirectWithError(root,()=>withPageCtx(async ctx=>{
    const quoteId=z.string().uuid().parse(f.get('quoteId'));
    const row=(await ctx.db.query(`select scope_json from cost_quotes where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 and operation='query_expansion'`,[quoteId,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
    const raw=row?.scope_json??{};
    const scope=LanguageScope.parse(languageScopeFields(raw));
    await prepareLanguageAi(ctx,scope);
    return reserveJob(ctx,{quoteId,idempotencyKey:z.string().uuid().parse(f.get('idem')),route:'POST /discover/language',operation:'query_expansion',scope,jobKind:'query_expansion',dedupeKey:`language:${quoteId}`,inputRef:scope,consent:f.get('consent')==='on'});
  }));
  redirect(`${root}?job=${job.jobId}`);
}
