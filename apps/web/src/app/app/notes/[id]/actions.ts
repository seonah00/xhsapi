
'use server';
import { AppError } from '@xhs/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { connectOriginalNoteLink, requestOriginalRefresh } from '@xhs/core';
import { env } from '@/server/env';
import { service, withPageCtx } from '@/server/ctx';
import { withAdmin } from '@/app/admin/forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
export async function connectOriginal(f: FormData) {
  const id=z.string().uuid().parse(f.get('noteId'));
  const back=`/app/notes/${id}`;
  await orRedirectWithError(back,()=>withAdmin(ctx=>connectOriginalNoteLink(ctx,service,id,f.get('shareUrl'))));
  redirect(`${back}?connected=1`);
}

export async function refreshOriginal(f: FormData) {
  const id=z.string().uuid().parse(f.get('noteId'));
  const back=`/app/notes/${id}`;
  const request=await orRedirectWithError(back,()=>withPageCtx(async ctx=>{
    try { return await requestOriginalRefresh(ctx,service,id,env()); }
    catch(e) {
      if(ctx.role!=='org_admin' && e instanceof AppError && ['LIVE_BLOCKED','BUDGET_EXCEEDED'].includes(e.code)) throw new AppError('FEATURE_DISABLED','현재 원문 링크를 다시 찾을 수 없습니다. 관리자에게 문의하세요.');
      throw e;
    }
  }));
  redirect(request ? `${back}?refresh=${request}` : back);
}
