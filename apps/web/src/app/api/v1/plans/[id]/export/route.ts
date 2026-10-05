import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withApiCtx } from '@/server/ctx';
import { loadHandoff, toMarkdown } from '@/server/handoff';
import { toAppError } from '@/server/api';

/** Download of the student's own version (re-checks ownership). Not a publish: no call to Xiaohongshu. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await params).id);
    const format = z.enum(['md', 'json']).parse(req.nextUrl.searchParams.get('format') ?? 'md');
    const versionId = req.nextUrl.searchParams.get('version') ?? undefined;
    const h = await withApiCtx((ctx) => loadHandoff(ctx, id, versionId ? z.string().uuid().parse(versionId) : undefined));
    const body = format === 'md' ? toMarkdown(h) : JSON.stringify({ dataMode: h.dataMode, demo: h.dataMode === 'mock', version: h.version.version, content: h.version.content, facts: h.version.facts, check: { state: h.checkState, unresolved: h.unresolved, note: '점검은 게시 승인이 아닙니다' } }, null, 2);
    return new NextResponse(body, { headers: {
      'content-type': format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="plan-v${h.version.version}.${format}"`, 'cache-control': 'no-store',
    } });
  } catch (e) {
    const err = toAppError(e);
    return NextResponse.json({ error: { code: err.code, messageKo: err.messageKo } }, { status: (e as { digest?: string })?.digest?.includes('404') ? 404 : err.status });
  }
}
