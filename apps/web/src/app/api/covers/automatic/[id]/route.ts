import { autoCoverStatus, notFound } from '@xhs/core';
import { api } from '@/server/api';
import { service, withApiCtx } from '@/server/ctx';
export const GET = api<{id:string}>(async (_req,{id}) => withApiCtx(async ctx => (await autoCoverStatus(ctx,service,id)) ?? notFound()));
