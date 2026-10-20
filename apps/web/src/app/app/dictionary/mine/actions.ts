'use server';
import {AppError} from '@xhs/domain';
import {savePersonalDictionary,archivePersonalDictionary} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {z} from 'zod';
export async function savePersonalAction(_previous:{id?:string;error?:string},form:FormData):Promise<{id?:string;error?:string}> {
 try {
  const raw=String(form.get('source')??'');
  if(raw.length>20000) throw new Error('oversize');
  const source=raw?JSON.parse(raw):{kind:'manual',term:String(form.get('term')??''),meaning:String(form.get('meaning')??''),entryType:String(form.get('entryType')??'expression')};
  const id=await withPageCtx(ctx=>savePersonalDictionary(ctx,source));
  revalidatePath('/app/dictionary/mine');return {id};
 } catch(e) {
  if(e instanceof AppError) return {error:e.messageKo};
  if(e instanceof z.ZodError || e instanceof SyntaxError || (e instanceof Error&&e.message==='oversize')) return {error:'저장할 항목을 확인해 주세요.'};
  throw e;
 }
}
export async function archivePersonalAction(form:FormData) {
 await withPageCtx(ctx=>archivePersonalDictionary(ctx,String(form.get('id'))));
 revalidatePath('/app/dictionary/mine');redirect('/app/dictionary/mine');
}
