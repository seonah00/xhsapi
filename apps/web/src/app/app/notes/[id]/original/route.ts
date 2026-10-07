import { toAppError } from '@/server/api';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { originalNoteLink } from '@xhs/core';
import { service, withApiCtx } from '@/server/ctx';

export async function GET(request: Request, { params }: { params: Promise<{id: string}> }) {
  try {
  const {id}=await params;
  if(!z.string().uuid().safeParse(id).success) return new Response(null,{status:404});
  const url=await withApiCtx(ctx=>originalNoteLink(ctx,service,id));
  const response=NextResponse.redirect(url ?? new URL(`/app/notes/${id}?link=unavailable`,request.url),302);
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('Referrer-Policy','no-referrer');
  return response;
  } catch(e) { const err=toAppError(e); return Response.json({error:err.messageKo},{status:err.status,headers:{'Cache-Control':'no-store'}}); }
}
