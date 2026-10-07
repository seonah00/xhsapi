import { LIVE_AUTH_BASE } from '../support/env.ts';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '@xhs/domain';
import { ProviderContractError, REDFOX_CAPABILITIES, RedfoxXhsProvider, type LiveGateContext } from '@xhs/providers';
import { safeCoverUrl } from '@xhs/security';

/** RF02 contract from the provider doc (2026-10-07). Payloads are synthetic in the documented shape. */
const allow = (): Omit<LiveGateContext, 'endpoint'> => ({
  env: loadEnv({ ...LIVE_AUTH_BASE, APP_DATA_MODE: 'live', LIVE_PROVIDER_CALLS_ENABLED: 'true' }),
  orgLiveEnabled: true, consentRecorded: true, budgetReserved: true, userApproved: true, purposes: ['fetch', 'metadata_display'],
  permission: { id: 'p', status: 'approved', expiresAt: null, allowedEndpoints: ['RF02'], allows: { fetch: true, metadata_display: true, excerpt_display: true, media_display: true, ai_processing: false, cache: false } },
});
const caps = { ...REDFOX_CAPABILITIES, RF02: { ...REDFOX_CAPABILITIES.RF02, priceStatus: 'verified' as const } };
const NOW = new Date('2026-10-07T02:00:00Z');
const provider = (f: unknown) => new RedfoxXhsProvider('ak_k', allow, f as never, caps, () => NOW, 'RF02');
const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
const COVER = 'https://sns-i10.rednotecdn.com/notes_pre_post/1040g3k0?imageView2/2/w/576/format/webp/q/87%7CimageMogr2/strip&sign=b6&t=6a05685d&src=A';
const work = (id: string, over: Record<string, unknown> = {}) => ({
  workId: id, workTitle: '建筑师的选择', workDesc: '正文 #净水器', coverUrl: COVER, workUrl: `https://www.xiaohongshu.com/explore/${id}`,
  workPublishTime: '2026-10-01 17:09:42', accountNickname: '示例作者', accountUserid: '565b17dc0bf90c754d6615b4', accountType: '100',
  workLikedCount: 210, workCommentsCount: 45, workCollectedCount: 175, workReadedCount: 980, workSharedCount: 28, workType: 'normal', ...over,
});

describe('RF02 keyword search contract (documented shape)', () => {
  it('sends keyword/offset/sortType and maps cover, type and read count', async () => {
    const f = respond({ code: 2000, msg: '成功', data: { total: 100, hasMore: true, list: [work('687df3a1000000000d0184a4'), work('687df3a1000000000d0184a5', { workType: 'video' })] } });
    const r = await provider(f).searchNotes({ query: ' 净水器 ' });
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://redfox.hk/story/api/xhsUser/searchArticle');
    expect(JSON.parse(String(init.body))).toEqual({ keyword: '净水器', offset: 0, sortType: '_4' });
    expect(r).toMatchObject({ endpoint: 'RF02', relatedTerms: [], latestHotArticles: [], coverage: { providerTotal: 100 } });
    expect(r.notes.map((n) => n.noteType)).toEqual(['image', 'video']);
    const n = r.notes[0]!;
    expect(n).toMatchObject({ coverUrl: COVER, publishedAt: '2026-10-01T09:09:42.000Z', providerTags: ['净水器'], author: { ref: '565b17dc0bf90c754d6615b4' } });
    expect(n.metrics.views).toMatchObject({ exact: 980, precision: 'exact' });
    expect(n.author.followers.precision).toBe('unknown'); // not in RF02: never invented
  });

  it('unknown work types stay unknown, days are filtered after the fetch, and a missing list wrapper is a contract violation', async () => {
    const f = respond({ code: 2000, data: { list: [work('687df3a1000000000d0184a6', { workType: '主要描述', workPublishTime: '2026-09-01 00:00:00' }), work('687df3a1000000000d0184a7')] } });
    const r = await provider(f).searchNotes({ query: 'x', days: 7 });
    expect(r.notes.map((n) => n.platformNoteId)).toEqual(['687df3a1000000000d0184a7']);
    expect(r.coverage.postFilters).toContain('days_filtered_after_fetch');
    const r2 = await provider(respond({ code: 2000, data: { list: [work('687df3a1000000000d0184a6', { workType: '主要描述' })] } })).searchNotes({ query: 'x' });
    expect(r2.notes[0]!.noteType).toBeNull();
    await expect(provider(respond({ code: 2000, data: { list: 'nope' } })).searchNotes({ query: 'x' })).rejects.toBeInstanceOf(ProviderContractError);
  });

  it('cover URLs must be https on a Xiaohongshu image CDN', () => {
    expect(safeCoverUrl(COVER)).toBe(COVER);
    expect(safeCoverUrl('https://ci.xiaohongshu.com.evil.com/x.jpg')).toBeNull();
    expect(safeCoverUrl('http://sns-i10.rednotecdn.com/x.jpg')).toBeNull();
    expect(safeCoverUrl('https://user:pw@sns-i10.rednotecdn.com/x.jpg')).toBeNull();
    expect(safeCoverUrl('javascript:alert(1)')).toBeNull();
    expect(safeCoverUrl('https://sns-webpic-qc.xhscdn.com/a.jpg')).toBe('https://sns-webpic-qc.xhscdn.com/a.jpg');
  });
});
