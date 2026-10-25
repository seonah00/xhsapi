'use server';
import {redirect} from 'next/navigation';
import {submitWritingReview,addWritingFeedback,withdrawWritingReview} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {orRedirectWithError} from '@/server/actions-util';
import {revalidatePath} from 'next/cache';
export async function requestReview(f:FormData){const draftId=String(f.get('draftId'));const id=await orRedirectWithError(`/app/write/history/${draftId}`,()=>withPageCtx(ctx=>submitWritingReview(ctx,{draftId,revision:Number(f.get('revision')),cohortId:String(f.get('cohortId')),confirm:f.get('confirm')==='on'})));revalidatePath('/review/submissions');redirect(`/app/write/reviews/${id}`);}
export async function feedback(f:FormData){const id=String(f.get('id'));await orRedirectWithError(`/app/write/reviews/${id}`,()=>withPageCtx(ctx=>addWritingFeedback(ctx,id,String(f.get('content')))));revalidatePath(`/app/write/reviews/${id}`);redirect(`/app/write/reviews/${id}`);}
export async function withdraw(f:FormData){const id=String(f.get('id'));await orRedirectWithError(`/app/write/reviews/${id}`,()=>withPageCtx(ctx=>withdrawWritingReview(ctx,id)));revalidatePath('/review/submissions');redirect(`/app/write/reviews/${id}`);}
