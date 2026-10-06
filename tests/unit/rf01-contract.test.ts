import { LIVE_AUTH_BASE } from '../support/env.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '@xhs/domain';
import {
  isUnchargedError, LiveCallBlockedError, ProviderBusinessError, ProviderContractError, ProviderHttpError, REDFOX_CAPABILITIES, RedfoxXhsProvider,
  type LiveGateContext,
} from '@xhs/providers';

/** RF01 contract from the provider doc (2026-10-06). Payloads are synthetic in the documented shape. */
const allow = (): Omit<LiveGateContext, 'endpoint'> => ({
  env: loadEnv({ ...LIVE_AUTH_BASE, APP_DATA_MODE: 'live', LIVE_PROVIDER_CALLS_ENABLED: 'true' }),
  orgLiveEnabled: true, consentRecorded: true, budgetReserved: true, userApproved: true, purposes: ['fetch', 'metadata_display'],
  permission: { id: 'p', status: 'approved', expiresAt: null, allowedEndpoints: ['RF01'], allows: { fetch: true, metadata_display: true, excerpt_display: true, media_display: false, ai_processing: false, cache: false } },
});
const caps = { ...REDFOX_CAPABILITIES, RF01: { ...REDFOX_CAPABILITIES.RF01, priceStatus: 'verified' as const } };
const NOW = new Date('2026-10-06T02:00:00Z'); // 10:00 in Shanghai
const provider = (f: unknown) => new RedfoxXhsProvider('ak_k', allow, f as never, caps, () => NOW);
const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const wrap = (data: unknown) => ({ code: 2000, msg: '成功', data });

const article = {
  id: '6a00000000000000000000a1', title: '测试笔记标题', desc: '今天分享护肤步骤 #护肤 #敏感肌 ', authorId: 'author000000000000000001', authorNickname: '示例作者',
  authorFans: 8614, likedCount: 629, collectedCount: 1120, commentsCount: 26, sharedCount: 228, interactiveCount: 1775, createTime: '2026-07-08 13:05:29',
  cover: 'http://sns-img.example.invalid/x.jpg', shareInfoLink: 'https://www.xiaohongshu.com/explore/6a00000000000000000000a1?xsec_token=abc', topicsName: null,
  popularityScore: 1, recencyScore: 0.5, relevanceScore: 6, totalScore: 7.5,
};
const doc = {
  articles: [article], hotTopics: [{ articleCount: 1, topic: '示例话题', totalInteractiveCount: 2 }], keyword: '护肤',
  latestHotArticles: [{ ...article, id: '6a00000000000000000000b2', popularityScore: null, recencyScore: null, relevanceScore: null, totalScore: null }],
  pageNum: 1, pageSize: 50, relatedSearches: [{ articleCount: 15248, keyword: '敏感肌护肤' }], tips: '仅找到 1 条结果', total: 1,
};

describe('RF01 search contract (documented shape)', () => {
  it('sends only documented params with the key as a header and maps without inventing values', async () => {
    const f = respond(wrap(doc));
    const r = await provider(f).searchNotes({ query: ' 护肤 ', days: 7 });
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://redfox.hk/story/api/xhs/search/search');
    expect(new Headers(init.headers).get('REDFOX_API_KEY')).toBe('ak_k');
    expect(JSON.parse(String(init.body))).toEqual({ keyword: '护肤', startDate: '2026-09-29', endDate: '2026-10-06' });
    expect(r).toMatchObject({ mode: 'live', endpoint: 'RF01', relatedTerms: ['敏感肌护肤'] });
    const n = r.notes[0]!;
    expect(n).toMatchObject({
      platformNoteId: '6a00000000000000000000a1', canonicalUrl: 'https://www.xiaohongshu.com/explore/6a00000000000000000000a1',
      noteType: null, publishedAt: '2026-07-08T05:05:29.000Z', topics: [], formats: [], author: { ref: 'author000000000000000001', displayName: '示例作者' },
    });
    expect(n.metrics.views.precision).toBe('unknown'); // no views from RF01: never used for save rates
    expect(n.metrics.saves).toMatchObject({ exact: 1120, precision: 'exact' });
    expect(n.providerTags).toEqual(expect.arrayContaining(['护肤', '敏感肌']));
    expect(JSON.stringify(n)).not.toContain('sns-img'); // cover images are not kept
    expect(r.latestHotArticles).toHaveLength(1); // kept separate (fallback)
  });

  it('without a keyword uses pageNum/pageSize; a bare (unwrapped) body is a contract violation', async () => {
    const f = respond(wrap(doc));
    await provider(f).searchNotes({ query: '' });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [URL, RequestInit])[1].body))).toEqual({ pageNum: 1, pageSize: 20 });
    await expect(provider(respond(doc)).searchNotes({ query: 'x' })).rejects.toBeInstanceOf(ProviderContractError);
  });

  it('missing fields stay null; malformed ids are dropped', async () => {
    const f = respond(wrap({ articles: [{ id: '6a00000000000000000000c3' }, { id: '../bad' }] }));
    const r = await provider(f).searchNotes({ query: 'x' });
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ title: null, bodyExcerpt: null, publishedAt: null, author: { ref: null } });
    expect(r.notes[0]!.metrics.likes.precision).toBe('unknown');
  });

  it('classifies failures: schema violation, business code, uncharged non-2xx, gate', async () => {
    await expect(provider(respond(wrap({ articles: 'nope' }))).searchNotes({ query: 'x' })).rejects.toBeInstanceOf(ProviderContractError);
    await expect(provider(respond({ code: 4001, msg: 'balance', data: null })).searchNotes({ query: 'x' })).rejects.toBeInstanceOf(ProviderBusinessError);
    const http = await provider(respond({}, 502)).searchNotes({ query: 'x' }).catch((e) => e);
    expect(http).toBeInstanceOf(ProviderHttpError);
    expect(isUnchargedError(http)).toBe(true);
    const spy = vi.fn();
    const blocked = new RedfoxXhsProvider('ak_k', allow, spy as never); // shipped registry: RF01 price unknown
    await expect(blocked.searchNotes({ query: 'x' })).rejects.toBeInstanceOf(LiveCallBlockedError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('RF01 against the sanitized real response (2026-10-06)', () => {
  const real = JSON.parse(readFileSync(new URL('../fixtures/redfox/rf01-live-2026-10-06.sanitized.json', import.meta.url), 'utf8'));

  it('parses the observed shape and keeps provider totals and unrelated fallbacks apart', async () => {
    const r = await provider(respond(real)).searchNotes({ query: 'AIGC创业' });
    expect(r.notes.map((n) => n.platformNoteId)).toEqual(['6a4dcb11aaaaaaaaaaaaaaaa']);
    expect(r.latestHotArticles).toHaveLength(2); // keyword-unrelated: never shown as results
    expect(r.coverage).toMatchObject({ providerTotal: 4, providerTip: '仅找到 4 条结果，以下内容可能也对你有帮助' });
    expect(r.relatedTerms).toEqual(['AIGC', '创业', 'AI创业']);
    expect(r.notes[0]!.providerTags).toEqual(expect.arrayContaining(['AI智能体', 'AIGC创业']));
  });

  it('createTime is China time: matches the note-id timestamp (+8h) for notes published on creation', async () => {
    const r = await provider(respond(real)).searchNotes({ query: 'AIGC创业' });
    for (const n of r.latestHotArticles) {
      const idSeconds = parseInt(n.platformNoteId.slice(0, 8), 16);
      expect(Date.parse(n.publishedAt!) / 1000).toBe(idSeconds);
    }
  });
});
