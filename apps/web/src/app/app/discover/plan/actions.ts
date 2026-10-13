'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { importKeywordPlan } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';

export async function importKeywords(f:FormData) {
  const source=String(f.get('source')??'').slice(0,10000);
  const selected=f.getAll('selected').map(String);
  const qs=new URLSearchParams({source,selected:JSON.stringify(selected)});
  const id=await orRedirectWithError(`/app/discover/plan?${qs}`,()=>withPageCtx(ctx=>importKeywordPlan(ctx,{
    source:z.string().transform((value,ctx)=>{try{return JSON.parse(value) as unknown;}catch{ctx.addIssue({code:'custom',message:'키워드 선택을 다시 확인하세요.'});return z.NEVER;}}).parse(source), selected, requestId:String(f.get('requestId')), accountId:String(f.get('accountId')), name:String(f.get('name')),
    facts:{subject:String(f.get('subject')??''),confirmedFacts:String(f.get('facts')??'').split('\n').map(s=>s.trim()).filter(Boolean),shootableScenes:String(f.get('scenes')??'').split('\n').map(s=>s.trim()).filter(Boolean),sponsorship:String(f.get('sponsorship')??'unknown')},
  })));
  revalidatePath('/app/plans');
  redirect(`/app/plans/${id}`);
}
