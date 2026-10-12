import { AppError } from '@xhs/domain';
import { requestAutoCover } from '@xhs/core';
import { api, jsonBody } from '@/server/api';
import { service, withApiCtx } from '@/server/ctx';
import { env } from '@/server/env';
import { z } from 'zod';

export const POST = api(async req => {
  const {noteIds} = z.object({noteIds:z.array(z.string().uuid()).min(1).max(50)}).parse(await jsonBody(req));
  return withApiCtx(async ctx => {
    try { return {jobId:await requestAutoCover(ctx,service,noteIds,env())}; }
    catch(e) {
      if(e instanceof AppError && ['LIVE_BLOCKED','FEATURE_DISABLED','BUDGET_EXCEEDED','RATE_LIMITED'].includes(e.code)) return {jobId:null};
      throw e;
    }
  });
});
