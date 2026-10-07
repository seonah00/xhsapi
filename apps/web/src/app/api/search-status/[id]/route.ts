import { toAppError } from '@/server/api';
import { z } from 'zod';
import { autoSearchStatus } from '@xhs/core';
import { service, withApiCtx } from '@/server/ctx';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}) {
  try {
  const {id}=await params;
  if(!z.string().uuid().safeParse(id).success) return new Response(null,{status:404});
  const status=await withApiCtx(ctx=>autoSearchStatus(ctx,service,id));
  return Response.json(status,{status:status?200:404,headers:{'Cache-Control':'no-store'}});
  } catch(e) { const err=toAppError(e); return Response.json({error:err.messageKo},{status:err.status,headers:{'Cache-Control':'no-store'}}); }
}
