'use server';
import {AppError} from '@xhs/domain';
import {redirect} from 'next/navigation';
import {saveCaseGuide,publishCaseGuide,importCaseGuide} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {orRedirectWithError} from '@/server/actions-util';
import {revalidatePath} from 'next/cache';
export async function saveGuide(f:FormData){
 const fields=['title','audience','situation','coverAnalysis','titleAnalysis','bodyStructure','videoStructure','reusable','avoidCopy'];
 const id=String(f.get('id')??'');
 const result=await orRedirectWithError('/app/guides',()=>withPageCtx(ctx=>saveCaseGuide(ctx,{...Object.fromEntries(fields.map(k=>[k,String(f.get(k)??'')])),...(f.get('sourceNoteId')?{sourceNoteId:String(f.get('sourceNoteId'))}:{}),questions:String(f.get('questions')??'').split('\n').map(v=>v.trim()).filter(Boolean),checklist:String(f.get('checklist')??'').split('\n').map(v=>v.trim()).filter(Boolean),...(id?{id,revision:Number(f.get('revision'))}:{})})));
 revalidatePath('/app/guides');redirect(`/app/guides/${result.id}`);
}
export async function publishGuide(f:FormData){
 const id=String(f.get('id'));
 await orRedirectWithError(`/app/guides/${id}`,async()=>{if(f.get('confirm')!=='on')throw new AppError('VALIDATION_FAILED','검토 확인이 필요합니다.');return withPageCtx(ctx=>publishCaseGuide(ctx,id,Number(f.get('revision'))));});
 revalidatePath('/app/guides');redirect(`/app/guides/${id}`);
}
export async function adaptGuide(f:FormData){const id=String(f.get('id'));await orRedirectWithError(`/app/guides/${id}`,()=>withPageCtx(ctx=>importCaseGuide(ctx,id,f.getAll('answers').map(String))));redirect('/app/write');}
