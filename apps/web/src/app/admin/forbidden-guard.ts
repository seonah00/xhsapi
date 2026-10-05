import 'server-only';
import { AppError } from '@xhs/domain';
import type { Ctx } from '@xhs/core';
import { notFound } from 'next/navigation';
import { withPageCtx } from '@/server/ctx';

/** Admin pages: non-admins get a 404 (the page's existence is not revealed). */
export async function withAdmin<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return withPageCtx(async (ctx) => {
    if (ctx.role !== 'org_admin') notFound();
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof AppError && e.code === 'FORBIDDEN') notFound();
      throw e;
    }
  });
}
