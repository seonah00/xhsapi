'use server';
import {ZodError} from 'zod';
import {startShootingWork,saveShootingWork,importShootingWork} from '@xhs/core';
import {AppError} from '@xhs/domain';
import {redirect} from 'next/navigation';
import {saveCaseGuide,publishCaseGuide,importCaseGuide} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {orRedirectWithError} from '@/server/actions-util';
import {revalidatePath} from 'next/cache';
export async function saveGuide(f:FormData){
 const fields=['title','audience','situation','coverAnalysis','titleAnalysis','bodyStructure','videoStructure','reusable','avoidCopy'];
 const id=String(f.get('id')??'');
 const shooting=await orRedirectWithError('/app/guides',async()=>{try{return f.get('shooting')?JSON.parse(String(f.get('shooting'))):undefined;}catch{throw new AppError('VALIDATION_FAILED','촬영 가이드 입력을 확인하세요.');}});

 const result=await orRedirectWithError('/app/guides',()=>withPageCtx(ctx=>saveCaseGuide(ctx,{...Object.fromEntries(fields.map(k=>[k,String(f.get(k)??'')])),...(shooting?{shooting}:{}),...(f.get('sourceNoteId')?{sourceNoteId:String(f.get('sourceNoteId'))}:{}),questions:String(f.get('questions')??'').split('\n').map(v=>v.trim()).filter(Boolean),checklist:String(f.get('checklist')??'').split('\n').map(v=>v.trim()).filter(Boolean),...(id?{id,revision:Number(f.get('revision'))}:{})})));
 revalidatePath('/app/guides');redirect(`/app/guides/${result.id}`);
}
export async function publishGuide(f:FormData){
 const id=String(f.get('id'));
 await orRedirectWithError(`/app/guides/${id}`,async()=>{if(f.get('confirm')!=='on')throw new AppError('VALIDATION_FAILED','검토 확인이 필요합니다.');return withPageCtx(ctx=>publishCaseGuide(ctx,id,Number(f.get('revision'))));});
 revalidatePath('/app/guides');redirect(`/app/guides/${id}`);
}
export async function adaptGuide(f:FormData){const id=String(f.get('id'));await orRedirectWithError(`/app/guides/${id}`,()=>withPageCtx(ctx=>importCaseGuide(ctx,id,f.getAll('answers').map(String))));redirect('/app/write');}
export async function startShooting(f:FormData){const id=String(f.get('guideId'));const workId=await orRedirectWithError(`/app/guides/${id}`,()=>withPageCtx(ctx=>startShootingWork(ctx,id)));redirect(`/app/guides/work/${workId}`);}
export async function saveShooting(_previous:{revision:number;error?:string;success?:boolean},f:FormData):Promise<{revision:number;error?:string;success?:boolean}>{
 try{const result=await withPageCtx(ctx=>saveShootingWork(ctx,{id:String(f.get('id')),revision:Number(f.get('revision')),subject:String(f.get('subject')??''),checked:f.getAll('checked').map(String),notes:Object.fromEntries(f.getAll('cutId').map(String).map(id=>[id,String(f.get('note:'+id)??'')])),memo:String(f.get('memo')??'')}));return {...result,success:true};}
 catch(e){if(e instanceof AppError)return {..._previous,error:e.messageKo,success:false};if(e instanceof ZodError)return {..._previous,error:'촬영 메모 길이와 입력을 확인하세요.',success:false};throw e;}
}
export async function importShooting(f:FormData){const id=String(f.get('id'));await orRedirectWithError(`/app/guides/work/${id}`,()=>withPageCtx(ctx=>importShootingWork(ctx,id,Number(f.get('revision')))));redirect('/app/write');}
