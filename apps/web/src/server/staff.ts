import 'server-only';
import { notFound } from 'next/navigation';
import type { Ctx } from '@xhs/core';
import { withPageCtx } from './ctx';

/** Reviewer/admin pages: students get a 404. */
export async function withStaff<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return withPageCtx(async (ctx) => {
    if (ctx.role !== 'reviewer' && ctx.role !== 'org_admin') notFound();
    return fn(ctx);
  });
}
