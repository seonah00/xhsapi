import { discover } from '@xhs/core';
import { api } from '@/server/api';
import { withApiCtx } from '@/server/ctx';

/** Stored data only: never triggers a provider call (spec 8 GET /discover). */
export const GET = api(async (req) => {
  const p = req.nextUrl.searchParams;
  return withApiCtx((ctx) => discover(ctx, {
    q: p.get('q') ?? '', topic: p.get('topic') ?? undefined, format: p.get('format') ?? undefined,
    days: p.get('days') ? Number(p.get('days')) : undefined, terms: p.getAll('terms').length ? p.getAll('terms') : undefined, cursor: p.get('cursor') ?? undefined,
  }));
});
