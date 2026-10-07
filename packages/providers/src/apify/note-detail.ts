import { z } from 'zod';
import { parseMetricValue } from '@xhs/domain';
import { safeCoverUrl, coverExpired } from '@xhs/security';
import { evaluateLiveGate, LiveCallBlockedError, type LiveGateContext } from '../gate.ts';
import type { EndpointCapability } from '../capabilities.ts';
import type { ProviderNote } from '../types.ts';
import { ProviderNotReadyError } from '../redfox/redfox-provider.ts';

export const APIFY_ACTOR = 'zen-studio/rednote-note-detail-scraper';
export const APIFY_DETAIL_CAPABILITY: EndpointCapability = {
  id: 'AP01', method: 'POST', path: '/v2/actors/zen-studio~rednote-note-detail-scraper/run-sync-get-dataset-items',
  purpose: 'selected note detail and cover', paramsStatus: 'documented', verificationStatus: 'documented',
  priceStatus: 'unknown', phase: 'P0', nonIdempotentSubmit: true,
  docUrl: 'https://apify.com/zen-studio/rednote-note-detail-scraper/input-schema',
};
export const ApifyBuild = z.string().regex(/^\d+\.\d+\.\d+$/);
const NoteId = z.string().regex(/^[a-f0-9]{24}$/);
const metric = z.number().finite().nonnegative().nullable().optional();
const Row = z.object({
  id: NoteId, type: z.enum(['video', 'normal', 'image']),
  title: z.string().max(10000).nullable().optional(), desc: z.string().max(100000).nullable().optional(),
  timestamp: z.number().finite().nonnegative().nullable().optional(),
  author: z.object({ userid: z.string().max(100).optional(), nickname: z.string().max(200).optional() }).optional(),
  engagement: z.object({ liked_count: metric, collected_count: metric, comments_count: metric, shared_count: metric }).optional(),
  images: z.array(z.object({ url_pre: z.string().nullable().optional(), url: z.string().nullable().optional() })).max(100).optional(),
  tags: z.array(z.object({ name: z.string().max(200) })).max(100).optional(),
});

/** Parse note metadata and preview URLs only; never retain tokens, original media or location. */
export function parseZenStudioNote(data: unknown, expectedId: string, now = new Date()): ProviderNote {
  const parsed = z.array(Row).length(1).safeParse(data);
  if (!parsed.success || parsed.data[0]!.id !== expectedId) throw new Error('APIFY_CONTRACT');
  const n = parsed.data[0]!;
  // Only the first image represents this note's cover; do not substitute unrelated gallery images.
  const first = n.images?.[0];
  const cover = [first?.url_pre, first?.url].map(safeCoverUrl).find(url => url && !coverExpired(url, now)) ?? null;
  // Zen Studio timestamps are Unix milliseconds (unlike the previous Actor's seconds).
  const published = n.timestamp == null ? null : new Date(n.timestamp);
  if (published && Number.isNaN(published.getTime())) throw new Error('APIFY_CONTRACT');
  return {
    platformNoteId: n.id, canonicalUrl: `https://www.xiaohongshu.com/explore/${n.id}`,
    title: n.title?.trim().slice(0, 500) || null, bodyExcerpt: n.desc?.slice(0, 200) || null,
    noteType: n.type === 'video' ? 'video' : 'image',
    author: { ref: n.author?.userid ?? null, displayName: n.author?.nickname || '작성자 미확인', followers: parseMetricValue(null) },
    publishedAt: published?.toISOString() ?? null, providerSnapshotAt: null,
    metrics: { likes: parseMetricValue(n.engagement?.liked_count), saves: parseMetricValue(n.engagement?.collected_count), comments: parseMetricValue(n.engagement?.comments_count), shares: parseMetricValue(n.engagement?.shared_count), views: parseMetricValue(null) },
    providerTags: [...new Set((n.tags ?? []).map(t => t.name.trim()).filter(Boolean))].slice(0, 30),
    coverUrl: cover, topics: [], formats: [],
  };
}

export type ApifyDetailOptions = { token: string; build: string; maxChargeUsd: string; gate: LiveGateContext };
export class ApifyNoteDetailProvider {
  constructor(private readonly options: ApifyDetailOptions, private readonly fetchImpl: typeof fetch = fetch) {}
  assertReady(platformNoteId: string): void {
    const o = this.options;
    if (!NoteId.safeParse(platformNoteId).success || !o.token.trim() || !ApifyBuild.safeParse(o.build).success
      || !/^\d{1,6}(\.\d{1,8})?$/.test(o.maxChargeUsd) || Number(o.maxChargeUsd) <= 0) throw new ProviderNotReadyError('APIFY_CONFIG');
    if (o.gate.endpoint.id !== 'AP01') throw new ProviderNotReadyError('APIFY_ENDPOINT');
    const checked = evaluateLiveGate({ ...o.gate, purposes: ['fetch', 'metadata_display', 'excerpt_display', 'media_display', 'cache'] });
    if (!checked.allowed) throw new LiveCallBlockedError(checked.reasons);
  }
  async noteDetail(input: { platformNoteId: string }): Promise<ProviderNote> {
    this.assertReady(input.platformNoteId);
    const o = this.options;
    const url = new URL(APIFY_DETAIL_CAPABILITY.path, 'https://api.apify.com');
    url.search = new URLSearchParams({ build: o.build, timeout: '120', maxTotalChargeUsd: o.maxChargeUsd, maxItems: '1', restartOnError: 'false', format: 'json' }).toString();
    // No retries: even a non-2xx or lost response may follow a billable Actor run.
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteUrls: [input.platformNoteId], downloadVideos: false, downloadCovers: false, downloadImages: false, downloadSubtitles: false }),
        redirect: 'error', signal: AbortSignal.timeout(150_000) });
    } catch { throw new Error('APIFY_RESPONSE_UNKNOWN'); }
    if (!res.ok) throw new Error(`APIFY_HTTP_${res.status}`);
    let data: unknown;
    try { data = await res.json(); } catch { throw new Error('APIFY_CONTRACT'); }
    return parseZenStudioNote(data, input.platformNoteId);
  }
}
