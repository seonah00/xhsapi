import { LIVE_AUTH_BASE } from '../support/env.ts';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '@xhs/domain';
import {
  createXhsProvider, evaluateLiveGate, LiveCallBlockedError, MockXhsProvider, mockFixtures,
  ProviderBusinessError, ProviderContractError, REDFOX_CAPABILITIES, RedfoxXhsProvider, type LiveGateContext, type ProviderPermission,
} from '@xhs/providers';

const fixedNow = () => new Date('2026-10-05T00:00:00Z');

describe('no external network in mock mode (spec 12.2)', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(`fetch ${String(input)}`);
      throw new Error('network disabled in tests');
    });
    vi.spyOn(http, 'request').mockImplementation(((...a: unknown[]) => { calls.push(`http ${String(a[0])}`); throw new Error('blocked'); }) as never);
    vi.spyOn(https, 'request').mockImplementation(((...a: unknown[]) => { calls.push(`https ${String(a[0])}`); throw new Error('blocked'); }) as never);
    vi.spyOn(net, 'connect').mockImplementation(((...a: unknown[]) => { calls.push(`net ${String(a[0])}`); throw new Error('blocked'); }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('runs every provider operation with keys present and makes zero outbound requests', async () => {
    const env = loadEnv({ REDFOX_API_KEY: 'ak_present_but_unused', OPENAI_API_KEY: 'sk-present-but-unused' });
    const provider = createXhsProvider(env, { mock: { now: fixedNow, transcriptPollsUntilDone: 1 } });
    expect(provider.mode).toBe('mock');

    await provider.searchNotes({ query: '护肤', topic: 'beauty', days: 30 });
    await provider.searchNotes({ query: mockFixtures.EMPTY_QUERY });
    await provider.noteDetail({ platformNoteId: mockFixtures.MOCK_NOTES[0]!.platformNoteId });
    const { taskId } = await provider.submitTranscript({ platformNoteId: mockFixtures.MOCK_NOTES[0]!.platformNoteId, accessUrl: 'https://www.xiaohongshu.com/explore/x' });
    await provider.transcriptResult({ taskId });
    await provider.transcriptResult({ taskId });

    expect(calls).toEqual([]);
  });
});

describe('mock fixtures', () => {
  const p = new MockXhsProvider({ now: fixedNow });

  it('has 6 topics x at least 8 synthetic notes on reserved demo URLs', () => {
    const byTopic = new Map<string, number>();
    for (const n of mockFixtures.MOCK_NOTES) for (const t of n.topics) byTopic.set(t, (byTopic.get(t) ?? 0) + 1);
    expect(byTopic.size).toBe(6);
    for (const count of byTopic.values()) expect(count).toBeGreaterThanOrEqual(8);
    for (const n of mockFixtures.MOCK_NOTES) expect(n.canonicalUrl.startsWith('https://demo.invalid/')).toBe(true);
    expect(new Set(mockFixtures.MOCK_NOTES.map((n) => n.platformNoteId)).size).toBe(mockFixtures.MOCK_NOTES.length);
  });

  it('returns empty results honestly and keeps latestHot separate', async () => {
    const r = await p.searchNotes({ query: mockFixtures.EMPTY_QUERY });
    expect(r.notes).toEqual([]);
    expect(r.latestHotArticles.length).toBeGreaterThan(0);
    const hotIds = new Set(r.latestHotArticles.map((n) => n.platformNoteId));
    const all = await p.searchNotes({ query: '' });
    expect(all.notes.some((n) => hotIds.has(n.platformNoteId))).toBe(false);
  });

  it('excludes unknown publish dates from date-filtered results', async () => {
    const r = await p.searchNotes({ query: '', days: 30 });
    expect(r.notes.every((n) => n.publishedAt !== null)).toBe(true);
    expect(r.coverage.postFilters).toContain('published_within_days');
  });

  it('never fills views (no save-rate source)', () => {
    expect(mockFixtures.MOCK_NOTES.every((n) => n.metrics.views.exact === null)).toBe(true);
  });
});

describe('F15 transcript mock flow', () => {
  const notes = mockFixtures.MOCK_NOTES;
  const run = async (noteId: string) => {
    const p = new MockXhsProvider({ now: fixedNow, transcriptPollsUntilDone: 2 });
    const { taskId } = await p.submitTranscript({ platformNoteId: noteId, accessUrl: 'https://www.xiaohongshu.com/explore/x' });
    const states = [];
    for (let i = 0; i < 3; i++) states.push(await p.transcriptResult({ taskId }));
    return states;
  };

  it('reports processing, then succeeded with ms-timed segments', async () => {
    const states = await run(notes[0]!.platformNoteId);
    expect(states.slice(0, 2).map((s) => s.status)).toEqual(['processing', 'processing']);
    const done = states[2]!;
    expect(done.status).toBe('succeeded');
    if (done.status === 'succeeded') {
      expect(done.segments.length).toBeGreaterThan(0);
      for (const s of done.segments) expect(s.endMs).toBeGreaterThan(s.startMs);
    }
  });

  it('distinguishes no speech, image notes and provider failure', async () => {
    const noSpeech = notes.find((n) => n.platformNoteId.startsWith('de0200'))!;
    expect((await run(noSpeech.platformNoteId))[2]).toMatchObject({ status: 'failed', failCode: 'no_speech_detected' });
    const image = notes.find((n) => n.noteType === 'image')!;
    expect((await run(image.platformNoteId))[2]).toMatchObject({ status: 'failed', failCode: 'not_video' });
    const failed = notes.find((n) => n.platformNoteId.startsWith('de0303'))!;
    expect((await run(failed.platformNoteId))[2]).toMatchObject({ status: 'failed', failCode: 'provider_failed' });
  });
});

describe('live gate (spec 6.3)', () => {
  const permission: ProviderPermission = {
    id: 'perm-1', status: 'approved', expiresAt: new Date('2027-01-01'), allowedEndpoints: ['RF13', 'RF14'],
    allows: { fetch: true, metadata_display: true, excerpt_display: true, media_display: false, ai_processing: true, cache: true },
  };
  const liveEnv = loadEnv({ ...LIVE_AUTH_BASE, APP_DATA_MODE: 'live', LIVE_PROVIDER_CALLS_ENABLED: 'true', TRANSCRIPT_ENABLED: 'true' });
  const verified = { ...REDFOX_CAPABILITIES.RF13, priceStatus: 'verified' as const };
  const base: LiveGateContext = {
    env: liveEnv, endpoint: verified, orgLiveEnabled: true, permission, purposes: ['fetch', 'ai_processing'],
    consentRecorded: true, budgetReserved: true, userApproved: true, now: fixedNow(),
  };

  it.each([null, { ...permission, status: 'revoked' as const }, { ...permission, expiresAt: new Date('2020-01-01'), allowedEndpoints: [] }])('does not require legacy permission records (%o)', (legacy) => {
    expect(evaluateLiveGate({ ...base, permission: legacy })).toEqual({ allowed: true });
  });
  it('allows only when every condition holds', () => {
    expect(evaluateLiveGate(base)).toEqual({ allowed: true });
  });
  it('blocks the shipped registry because prices are unknown', () => {
    expect(evaluateLiveGate({ ...base, endpoint: REDFOX_CAPABILITIES.RF13 })).toMatchObject({ allowed: false, reasons: ['price_unknown'] });
  });
  it('blocks unverified parameters (RF08/RF10)', () => {
    const r = evaluateLiveGate({ ...base, endpoint: { ...REDFOX_CAPABILITIES.RF08, priceStatus: 'verified' }, permission: { ...permission, allowedEndpoints: ['RF08'] } });
    expect(r).toMatchObject({ allowed: false, reasons: ['parameter_unverified'] });
  });
  it.each([
    [{ env: loadEnv({}) }, 'mode_not_live'],
    [{ env: loadEnv({ ...LIVE_AUTH_BASE, APP_DATA_MODE: 'live', LIVE_PROVIDER_CALLS_ENABLED: 'true' }) }, 'feature_disabled'],
    [{ orgLiveEnabled: false }, 'org_switch_off'],
    [{ consentRecorded: false }, 'consent_missing'],
    [{ budgetReserved: false }, 'budget_not_reserved'],
    [{ userApproved: false }, 'not_user_approved'],
  ] as const)('blocks when %o (%s)', (patch, reason) => {
    const r = evaluateLiveGate({ ...base, ...patch } as LiveGateContext);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasons).toContain(reason);
  });

  it('live adapter refuses before touching the network', async () => {
    const fetchSpy = vi.fn();
    const p = new RedfoxXhsProvider('ak_test_key', () => ({ ...base, budgetReserved: false }), fetchSpy as never);
    await expect(p.submitTranscript({ platformNoteId: 'x', accessUrl: 'https://www.xiaohongshu.com/explore/x' })).rejects.toBeInstanceOf(LiveCallBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not register the excluded video download endpoint', () => {
    expect(Object.values(REDFOX_CAPABILITIES).some((c) => c.path.includes('videoDownload'))).toBe(false);
  });
});

describe('RF14 contract handling', () => {
  const allowAll = (): Omit<LiveGateContext, 'endpoint'> => ({
    env: loadEnv({ ...LIVE_AUTH_BASE, APP_DATA_MODE: 'live', LIVE_PROVIDER_CALLS_ENABLED: 'true', TRANSCRIPT_ENABLED: 'true' }),
    orgLiveEnabled: true, consentRecorded: true, budgetReserved: true, userApproved: true, purposes: [],
    permission: { id: 'p', status: 'approved', expiresAt: null, allowedEndpoints: ['RF13', 'RF14'], allows: { fetch: true, metadata_display: true, excerpt_display: true, media_display: false, ai_processing: true, cache: true } },
  });
  // Contract tests run against a registry copy with a verified price; the shipped registry stays blocked.
  const caps = { ...REDFOX_CAPABILITIES, RF13: { ...REDFOX_CAPABILITIES.RF13, priceStatus: 'verified' as const }, RF14: { ...REDFOX_CAPABILITIES.RF14, priceStatus: 'verified' as const } };
  const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  const provider = (f: unknown) => new RedfoxXhsProvider('ak_k', allowAll, f as never, caps);

  it('maps documented payloads and sends the key only as a header', async () => {
    const f = respond({ code: 2000, msg: '成功', data: { taskId: 't', status: 'succeeded', failReason: null, text: '好！', stampSents: [{ textSeg: '好！', start: 2200, end: 2280 }] } });
    await expect(provider(f).transcriptResult({ taskId: 't' })).resolves.toMatchObject({ status: 'succeeded', segments: [{ startMs: 2200, endMs: 2280 }] });
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://redfox.hk/story/api/parseWork/audioTextExtract/result/xhs');
    expect(String(init.body)).not.toContain('ak_k');
  });

  it('treats an empty succeeded transcript as no speech', async () => {
    const f = respond({ code: 2000, data: { taskId: 't', status: 'succeeded', text: '', stampSents: [] } });
    await expect(provider(f).transcriptResult({ taskId: 't' })).resolves.toMatchObject({ status: 'failed', failCode: 'no_speech_detected' });
  });

  it('rejects undocumented status values as a contract violation', async () => {
    const f = respond({ code: 2000, data: { taskId: 't', status: 'pending' } });
    await expect(provider(f).transcriptResult({ taskId: 't' })).rejects.toBeInstanceOf(ProviderContractError);
  });

  it('treats HTTP 200 with a non-2000 code as a business error', async () => {
    const f = respond({ code: 4001, msg: 'insufficient balance', data: null });
    await expect(provider(f).submitTranscript({ platformNoteId: 'x', accessUrl: 'https://www.xiaohongshu.com/explore/x' })).rejects.toBeInstanceOf(ProviderBusinessError);
  });
});
