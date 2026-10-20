'use server';
import {AppError} from '@xhs/domain';
import {savePersonalDictionary,archivePersonalDictionary,editPersonalDictionary} from '@xhs/core';
import {withPageCtx,withApiCtx} from '@/server/ctx';
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

export async function editPersonalAction(_previous:{revision?:number;error?:string;success?:boolean},form:FormData):Promise<{revision?:number;error?:string;success?:boolean}>{
 try{
  const zh=form.getAll('exampleZh').map(String),ko=form.getAll('exampleKo').map(String);
  const examples=zh.map((value,index)=>({zh:value,ko:ko[index]??''})).filter(e=>e.zh.trim()||e.ko.trim());
  const revision=await withApiCtx(ctx=>editPersonalDictionary(ctx,{id:String(form.get('id')),revision:Number(form.get('revision')),meaning:String(form.get('meaning')??''),note:String(form.get('note')??''),folder:String(form.get('folder')??''),favorite:form.get('favorite')==='on',usage:String(form.get('usage')??''),examples}));
  revalidatePath('/app/dictionary/mine');return {revision,success:true};
 }catch(e){
  if(e instanceof AppError)return {..._previous,success:false,error:e.messageKo};
  if(e instanceof z.ZodError)return {..._previous,success:false,error:'입력 길이를 확인하고, 예문은 중국어 문장을 함께 입력하세요.'};
  throw e;
 }
}
