'use server';
import {duplicateWriting,restoreWritingVersion,setWritingArchived} from '@xhs/core';
import {AppError} from '@xhs/domain';
import {withApiCtx} from '@/server/ctx';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
export async function manageWritingAction(_previous:{error?:string},form:FormData):Promise<{error?:string}>{
 let target='';
 try{
  const id=z.string().uuid().parse(form.get('id')),revision=z.coerce.number().int().positive().parse(form.get('revision'));
  const intent=z.enum(['duplicate','archive','unarchive','restore']).parse(form.get('intent'));
  await withApiCtx(async ctx=>{
   if(intent==='duplicate'){const copy=await duplicateWriting(ctx,id,revision);target=`/app/write/history/${copy.id}?notice=copied`;}
   else if(intent==='restore'){const source=z.coerce.number().int().positive().parse(form.get('sourceRevision'));const result=await restoreWritingVersion(ctx,id,revision,source);target=`/app/write/history/${id}?restored=${result.revision}`;}
   else{await setWritingArchived(ctx,id,revision,intent==='archive');target=intent==='archive'?'/app/write/history?state=archived&notice=archived':`/app/write/history/${id}?notice=unarchived`;}
  });
  revalidatePath('/app/write/history');revalidatePath(`/app/write/history/${id}`);
 }catch(e){if(e instanceof AppError)return {error:e.messageKo};if(e instanceof z.ZodError)return {error:'저장본을 다시 열어 작업해 주세요.'};throw e;}
 redirect(target);
}
