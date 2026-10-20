'use server';
import {AppError} from '@xhs/domain';
import {saveWriting,getTemporaryWriting,saveTemporaryWriting} from '@xhs/core';
import {withPageCtx,withApiCtx} from '@/server/ctx';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
export async function saveWritingAction(_previous:{id?:string;revision?:number;error?:string},form:FormData):Promise<{id?:string;revision?:number;error?:string}> {
 try {
  const result=await withPageCtx(ctx=>saveWriting(ctx,{id:String(form.get('id')),revision:Number(form.get('revision')),title:String(form.get('title')??''),cover:String(form.get('cover')??''),body:String(form.get('body')??''),meaningKo:String(form.get('meaningKo')??''),tags:String(form.get('tags')??'').split(/[\s,#，]+/).filter(Boolean),entryIds:form.getAll('entryIds').map(String)}));
  revalidatePath('/app/write/history');revalidatePath(`/app/write/history/${result.id}`);return result;
 } catch(e) {
  if(e instanceof AppError) return {..._previous,error:e.messageKo};
  if(e instanceof z.ZodError) return {..._previous,error:'제목·본문 길이와 태그 개수를 확인해 주세요.'};
  throw e;
 }
}

export async function loadTemporaryAction(scope:string){
 return withApiCtx(ctx=>getTemporaryWriting(ctx,scope));
}
export async function storeTemporaryAction(raw:unknown):Promise<{version?:number;error?:string}>{
 try{return await withApiCtx(ctx=>saveTemporaryWriting(ctx,raw));}
 catch(e){if(e instanceof AppError)return {error:e.messageKo};if(e instanceof z.ZodError)return {error:'임시 저장할 내용의 길이와 항목을 확인해 주세요.'};throw e;}
}
