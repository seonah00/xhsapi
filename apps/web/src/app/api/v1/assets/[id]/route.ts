import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteAsset, readAsset } from '@xhs/core';
import { api, toAppError } from '@/server/api';
import { withApiCtx } from '@/server/ctx';
import { assetStorage } from '@/server/storage';

/** Gateway download: authorization re-checked on every request; never cached or sniffed. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await params).id);
    const a = await withApiCtx((ctx) => readAsset(ctx, assetStorage(), id));
    const inline = a.mime.startsWith('image/');
    return new NextResponse(Buffer.from(a.bytes), { headers: {
      'content-type': a.mime,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch (e) {
    const err = toAppError(e);
    return NextResponse.json({ error: { code: err.code, messageKo: err.messageKo } }, { status: err.status });
  }
}

export const DELETE = api<{ id: string }>(async (_r, { id }) => withApiCtx(async (ctx) => { await deleteAsset(ctx, assetStorage(), z.string().uuid().parse(id)); return { deleted: true }; }));
