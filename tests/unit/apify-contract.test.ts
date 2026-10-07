import { describe, expect, it, vi } from 'vitest';
import { redactString } from '@xhs/security';
import { loadEnv } from '@xhs/domain';
import { ApifyNoteDetailProvider, APIFY_DETAIL_CAPABILITY, parseZenStudioNote } from '../../packages/providers/src/apify/note-detail.ts';
import fixture from '../fixtures/apify/note-detail.sanitized.json' with { type: 'json' };
import type { LiveGateContext } from '@xhs/providers';

const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const gate = (): LiveGateContext => ({
  env: { ...loadEnv({}), APP_DATA_MODE: 'live', LIVE_PROVIDER_CALLS_ENABLED: true, APIFY_ENABLED: true },
  endpoint: { ...APIFY_DETAIL_CAPABILITY, priceStatus: 'verified' }, orgLiveEnabled: true,
  permission: { id: 'test', status: 'approved', expiresAt: null, allowedEndpoints: ['AP01'],
    allows: { fetch: true, metadata_display: true, excerpt_display: true, media_display: true, cache: true, ai_processing: false } },
  purposes: ['fetch', 'metadata_display', 'excerpt_display', 'media_display', 'cache'],
  consentRecorded: true, budgetReserved: true, userApproved: true,
});
const options = () => ({ token: 'apify_api_TEST_ONLY_NEVER_REAL', build: '1.2.3', maxChargeUsd: '0.05000000', gate: gate() });

describe('Zen Studio note detail contract (synthetic only)', () => {
  it('maps one matching note, strips access tokens and omits video, location and account balance', () => {
    const note = parseZenStudioNote(fixture, id);
    expect(note).toMatchObject({ platformNoteId: id, title: '美食 vlog', noteType: 'video', bodyExcerpt: '合成测试内容', providerTags: ['美食'], coverUrl: 'https://sns-na-i4.xhscdn.com/synthetic-cover.jpg' });
    expect(note.publishedAt).toBe(new Date(1780000000 * 1000).toISOString());
    expect(note.metrics.likes.exact).toBe(123);
    expect(note.metrics.views.precision).toBe('unknown');
    expect(JSON.stringify(note)).not.toMatch(/xsec_token|video_video_url|points|ip_location/);
  });
  it.each([[], [{ ...fixture[0], id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }], [fixture[0], fixture[0]], [{ error: 'provider failed' }]].map(rows => ({rows})))('rejects empty, unrelated, duplicate and error results', ({rows}) => {
    expect(() => parseZenStudioNote(rows, id)).toThrow('APIFY_CONTRACT');
  });
  it('drops unsafe covers but does not assume t is expiry and bounds stored excerpts', () => {
    expect(parseZenStudioNote([{ ...fixture[0], images: [{ url_pre: 'http://localhost/private' }], desc: 'x'.repeat(300) }], id).coverUrl).toBeNull();
    expect(parseZenStudioNote([{ ...fixture[0], images: [{ url_pre: 'https://sns-na-i4.xhscdn.com/a?t=00000001' }] }], id).coverUrl).toBe('https://sns-na-i4.xhscdn.com/a?t=00000001');
    expect(parseZenStudioNote([{ ...fixture[0], desc: 'x'.repeat(300) }], id).bodyExcerpt?.length).toBe(200);
  });
  it('prefers a valid signed preview, preserves its signature, and never uses originals', () => {
    const preview = 'https://sns-i11.rednotecdn.com/synthetic?w=576&sign=test&t=7fffffff';
    expect(parseZenStudioNote([{ ...fixture[0], images: [{ url_pre: preview, url: 'https://sns-na-i4.xhscdn.com/other.jpg' }] }], id).coverUrl).toBe(preview);
    expect(parseZenStudioNote([{ ...fixture[0], images: [{ url_original: 'https://ci.xiaohongshu.com/original' }] }], id).coverUrl).toBeNull();
    expect(parseZenStudioNote([{ ...fixture[0], images: [{ url_pre: 'https://localhost/private', url: preview }] }], id).coverUrl).toBe(preview);
    expect(parseZenStudioNote([{ ...fixture[0], images: [] }], id).coverUrl).toBeNull();
  });
  it('sends one bounded detail request with header auth and a pinned build', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify(fixture)));
    const provider = new ApifyNoteDetailProvider(options(), fake as typeof fetch);
    await provider.noteDetail({ platformNoteId: id });
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.hostname).toBe('api.apify.com');
    expect(url.pathname).toContain('zen-studio~rednote-note-detail-scraper');
    expect(url.searchParams.get('build')).toBe('1.2.3');
    expect(url.searchParams.get('maxTotalChargeUsd')).toBe('0.05000000');
    expect(url.searchParams.has('token')).toBe(false);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${options().token}`);
    expect(JSON.parse(String(init.body))).toEqual({ noteUrls: [id], downloadVideos: false, downloadCovers: false, downloadImages: false, downloadSubtitles: false });
    expect(init.redirect).toBe('error');
  });
  it.each(['mode', 'flag', 'price', 'consent', 'budget', 'approval', 'token', 'build', 'cost'])('blocks %s before fetch', async (reason) => {
    const o = options();
    if (reason === 'mode') o.gate.env.APP_DATA_MODE = 'mock';
    if (reason === 'flag') o.gate.env.APIFY_ENABLED = false;
    if (reason === 'price') o.gate.endpoint.priceStatus = 'unknown';
    if (reason === 'consent') o.gate.consentRecorded = false;
    if (reason === 'budget') o.gate.budgetReserved = false;
    if (reason === 'approval') o.gate.userApproved = false;
    if (reason === 'token') o.token = '';
    if (reason === 'build') o.build = 'latest';
    if (reason === 'cost') o.maxChargeUsd = '0';
    const fake = vi.fn();
    await expect(new ApifyNoteDetailProvider(o, fake).noteDetail({ platformNoteId: id })).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
  });
  it('keeps configuration and errors free of exposed secrets', () => {
    expect(loadEnv({ APIFY_TOKEN: options().token, APIFY_ACTOR_BUILD: '' }).APP_DATA_MODE).toBe('mock');
    expect(() => loadEnv({ APIFY_ENABLED: 'true' })).toThrow();
    expect(redactString(options().token)).toBe('[REDACTED]');
  });
  it('does not retry a lost response or invalid JSON', async () => {
    for (const fake of [vi.fn(async () => { throw new Error(options().token); }), vi.fn(async () => new Response('invalid-json'))]) {
      await expect(new ApifyNoteDetailProvider(options(), fake).noteDetail({ platformNoteId: id })).rejects.toThrow(/^APIFY_(RESPONSE_UNKNOWN|CONTRACT)$/);
      expect(fake).toHaveBeenCalledTimes(1);
    }
  });
  it('does not retry or expose provider error bodies / secrets', async () => {
    const fake = vi.fn(async () => new Response('secret-provider-body', { status: 500 }));
    await expect(new ApifyNoteDetailProvider(options(), fake).noteDetail({ platformNoteId: id })).rejects.toThrow('APIFY_HTTP_500');
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
