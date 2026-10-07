import { sha256Hex } from '@xhs/domain';
import { extractHashtags, parseMetricValue, type TopicSlug } from '@xhs/domain';
import { assertFetchableUrl, coverExpired, normalizeXhsNoteUrl, safeCoverUrl } from '@xhs/security';
import { REDFOX_BASE_URL, REDFOX_CAPABILITIES, type EndpointCapability, type EndpointId } from '../capabilities.ts';
import { evaluateLiveGate, LiveCallBlockedError, type LiveGateContext } from '../gate.ts';
import type { ProviderNote, SearchResult, TranscriptResult, TranscriptSubmit, XhsDataProvider } from '../types.ts';
import type { z } from 'zod';
import { REDFOX_SUCCESS, RedfoxEnvelope, Rf01Data, Rf02Data, Rf13Data, Rf14Data, type Rf01Article, type Rf02Work } from './schemas.ts';

export class ProviderContractError extends Error {
  override name = 'ProviderContractError';
}
export class ProviderBusinessError extends Error {
  override name = 'ProviderBusinessError';
  constructor(readonly providerCode: number) {
    super(`provider business error ${providerCode}`);
  }
}

/** Refused before any request left the server (no cost can have been incurred). */
export class ProviderNotReadyError extends Error {
  override name = 'ProviderNotReadyError';
  readonly sent = false;
}

/**
 * The provider answered with a non-2xx HTTP status. Its pricing page states failed (non-200)
 * requests are not charged, and the request had no effect on the provider side.
 */
export class ProviderHttpError extends Error {
  override name = 'ProviderHttpError';
  constructor(readonly status: number) {
    super(`provider http ${status}`);
  }
}

/**
 * True when no charge and no provider-side effect can have happened: refused before sending,
 * or rejected with a non-2xx status. A reservation for such a call is released.
 */
export function isUnchargedError(e: unknown): boolean {
  return e instanceof LiveCallBlockedError || e instanceof ProviderNotReadyError || e instanceof ProviderHttpError;
}

export type GateContextFor = (endpoint: EndpointId) => Omit<LiveGateContext, 'endpoint'>;

/** Endpoints that can serve a keyword search. RF02 also returns cover images, note type and read counts. */
export type SearchEndpoint = 'RF01' | 'RF02';

/**
 * Live RedFox adapter. Every call passes the spec 6.3 gate first; the key is read
 * server-side only and never logged. Endpoints without a verified response
 * contract fixture refuse to run rather than guess field shapes.
 */
export class RedfoxXhsProvider implements XhsDataProvider {
  readonly mode = 'live' as const;

  constructor(
    private readonly apiKey: string,
    private readonly gateFor: GateContextFor,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly capabilities: Readonly<Record<EndpointId, EndpointCapability>> = REDFOX_CAPABILITIES,
    private readonly now: () => Date = () => new Date(),
    /** Chosen when the quote was priced; the job keeps using it even if prices change meanwhile. */
    private readonly searchEndpoint: SearchEndpoint = 'RF01',
  ) {}

  async searchNotes(input: { query: string; topic?: TopicSlug; days?: 7 | 14 | 30; offset?: number }): Promise<SearchResult> {
    const offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 180 || offset % 20 !== 0) throw new ProviderNotReadyError('invalid search offset');
    if (this.searchEndpoint === 'RF02') return this.searchNotesRf02(input);
    const keyword = input.query.trim();
    if (offset !== 0) throw new ProviderNotReadyError('RF01 keyword pagination is not supported');
    const body: Record<string, unknown> = keyword ? { keyword } : { pageNum: 1, pageSize: 20 }; // pageNum/pageSize apply only without a keyword
    if (input.days) {
      body.startDate = shanghaiDate(this.now(), -input.days);
      body.endDate = shanghaiDate(this.now(), 0);
    }
    const fetchedAt = this.now().toISOString();
    const parsed = Rf01Data.safeParse(await this.post('RF01', body));
    if (!parsed.success) throw new ProviderContractError('RF01 response failed schema');
    const d = parsed.data;
    return {
      mode: 'live', endpoint: 'RF01', fetchedAt,
      notes: (d.articles ?? []).map(toNote).filter((x): x is ProviderNote => !!x),
      latestHotArticles: (d.latestHotArticles ?? []).map(toNote).filter((x): x is ProviderNote => !!x),
      relatedTerms: (d.relatedSearches ?? []).map((r) => r.keyword.trim()).filter((k) => k.length > 0 && k.length <= 40).slice(0, 20),
      // The provider has no topic filter; our topic classification is not applied to live notes yet.
      coverage: { requestedPages: 1, fetchedPages: 1, postFilters: input.topic ? ['topic_not_supported_by_provider'] : [], providerTotal: d.total ?? null, providerTip: d.tips ?? null },
    };
  }

  /** RF02: one bounded page (offset increments by 20, most interactions first: `_4`). The provider has no date filter, so `days` is applied here. */
  private async searchNotesRf02(input: { query: string; topic?: TopicSlug; days?: 7 | 14 | 30; offset?: number }): Promise<SearchResult> {
    const keyword = input.query.trim();
    if (!keyword) throw new ProviderNotReadyError('RF02 requires a keyword');
    const fetchedAt = this.now().toISOString();
    const parsed = Rf02Data.safeParse(await this.post('RF02', { keyword, offset: input.offset ?? 0, sortType: '_4' }));
    if (!parsed.success) throw new ProviderContractError('RF02 response failed schema');
    const list = parsed.data.list ?? [];
    const covers = { kept: 0, missing: 0, expired: 0, refusedHosts: {} as Record<string, number> };
    for (const w of list) {
      const safe = safeCoverUrl(w.coverUrl);
      if (!w.coverUrl?.trim()) covers.missing += 1;
      else if (safe && coverExpired(safe, this.now())) covers.expired += 1;
      else if (safe) covers.kept += 1;
      else {
        let host = 'invalid';
        try { host = new URL(w.coverUrl.trim().startsWith('//') ? `https:${w.coverUrl.trim()}` : w.coverUrl.trim()).hostname.slice(0, 80); } catch { /* invalid */ }
        covers.refusedHosts[host] = (covers.refusedHosts[host] ?? 0) + 1;
      }
    }
    let notes = list.map(toNoteRf02).filter((x): x is ProviderNote => !!x);
    const postFilters: string[] = input.topic ? ['topic_not_supported_by_provider'] : [];
    if (input.days) {
      const since = this.now().getTime() - input.days * 86_400_000;
      notes = notes.filter((n) => n.publishedAt !== null && Date.parse(n.publishedAt) >= since);
      postFilters.push('days_filtered_after_fetch');
    }
    return {
      mode: 'live', endpoint: 'RF02', fetchedAt, notes, latestHotArticles: [], relatedTerms: [],
      coverage: { rawCount: list.length, hasMore: parsed.data.hasMore == null ? null : !!parsed.data.hasMore, pageFingerprint: sha256Hex(JSON.stringify(list.map(w => w.workId).sort())), requestedPages: 1, fetchedPages: 1, postFilters, providerTotal: parsed.data.total ?? null, providerTip: null, covers },
    };
  }

  async noteDetail(_input: { platformNoteId: string }): Promise<ProviderNote | null> {
    this.assertAllowed('RF09');
    throw new ProviderNotReadyError('RF09 response contract not verified');
  }

  async submitTranscript(input: { platformNoteId: string; accessUrl: string }): Promise<TranscriptSubmit> {
    const data = await this.post('RF13', { url: input.accessUrl });
    return Rf13Data.parse(data);
  }

  async transcriptResult(input: { taskId: string }): Promise<TranscriptResult> {
    const parsed = Rf14Data.safeParse(await this.post('RF14', { taskId: input.taskId }));
    if (!parsed.success) throw new ProviderContractError('RF14 response failed schema');
    const d = parsed.data;
    if (d.status === 'processing') return { status: 'processing', taskId: d.taskId };
    if (d.status === 'failed') return { status: 'failed', taskId: d.taskId, failCode: 'provider_failed' };
    const segments = (d.stampSents ?? []).map((s, seq) => ({ seq, startMs: s.start, endMs: s.end, text: s.textSeg }));
    const text = d.text ?? '';
    if (text.trim() === '' && segments.length === 0) return { status: 'failed', taskId: d.taskId, failCode: 'no_speech_detected' };
    return { status: 'succeeded', taskId: d.taskId, text, segments };
  }

  private assertAllowed(id: EndpointId): void {
    const result = evaluateLiveGate({ ...this.gateFor(id), endpoint: this.capabilities[id] });
    if (!result.allowed) throw new LiveCallBlockedError(result.reasons);
  }

  private async post(id: EndpointId, body: unknown): Promise<unknown> {
    this.assertAllowed(id);
    const url = assertFetchableUrl(REDFOX_BASE_URL + this.capabilities[id].path, ['redfox.hk']);
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', REDFOX_API_KEY: this.apiKey },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ProviderHttpError(res.status);
    // Every endpoint, RF01 included (confirmed by a real response on 2026-10-06), uses the code/msg/data wrapper.
    const env = RedfoxEnvelope.safeParse(await res.json());
    if (!env.success) throw new ProviderContractError(`${id} envelope failed schema`);
    if (env.data.code !== REDFOX_SUCCESS) throw new ProviderBusinessError(env.data.code);
    return env.data.data;
  }
}

/** yyyy-MM-dd in China time (the provider's date filter), offset by whole days. */
function shanghaiDate(now: Date, offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now.getTime() + offsetDays * 86_400_000));
}

/** "2026-07-08 13:05:29" without zone = China time (UTC+8): confirmed against note-id timestamps in a real response (2026-10-06). */
function parseCreateTime(v: string | null | undefined): string | null {
  const m = v ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(v.trim()) : null;
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const NOTE_ID = /^[0-9a-zA-Z]{8,64}$/;

/** Maps one documented RF01 article. Missing fields stay null; views are never filled (spec 5.3). */
function toNote(a: z.infer<typeof Rf01Article>): ProviderNote | null {
  if (!NOTE_ID.test(a.id)) return null;
  let canonicalUrl = `https://www.xiaohongshu.com/explore/${a.id}`;
  if (a.shareInfoLink) {
    try { const normalized = normalizeXhsNoteUrl(a.shareInfoLink); if (normalized.noteId === a.id.toLowerCase()) canonicalUrl = normalized.canonicalUrl; } catch { /* keep the id-based URL */ }
  }
  const tags = new Set([...extractHashtags(a.desc), ...(a.topicsName ?? '').split(/[,，\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean)]);
  return {
    platformNoteId: a.id,
    canonicalUrl,
    title: a.title?.trim() || null,
    bodyExcerpt: a.desc ? a.desc.slice(0, 200) : null,
    noteType: null,
    author: { ref: a.authorId ?? null, displayName: a.authorNickname?.trim() || '작성자 미확인', followers: parseMetricValue(a.authorFans) },
    publishedAt: parseCreateTime(a.createTime),
    providerSnapshotAt: null,
    metrics: {
      likes: parseMetricValue(a.likedCount), saves: parseMetricValue(a.collectedCount), comments: parseMetricValue(a.commentsCount),
      shares: parseMetricValue(a.sharedCount), views: parseMetricValue(null),
    },
    providerTags: [...tags].slice(0, 30),
    topics: [],
    formats: [],
  };
}

/** RF02 `workType`: documented values are "normal" (image/text) and "video"; anything else stays unknown. */
function workType(v: string | null | undefined): 'video' | 'image' | null {
  const t = v?.trim().toLowerCase();
  return t === 'video' ? 'video' : t === 'normal' ? 'image' : null;
}

/** Maps one RF02 work. Author followers are not in this response; read count is the provider's view metric. */
function toNoteRf02(w: Rf02Work): ProviderNote | null {
  if (!NOTE_ID.test(w.workId)) return null;
  let canonicalUrl = `https://www.xiaohongshu.com/explore/${w.workId}`;
  if (w.workUrl) {
    try { const normalized = normalizeXhsNoteUrl(w.workUrl); if (normalized.noteId === w.workId.toLowerCase()) canonicalUrl = normalized.canonicalUrl; } catch { /* keep the id-based URL */ }
  }
  return {
    platformNoteId: w.workId,
    canonicalUrl,
    title: w.workTitle?.trim() || null,
    bodyExcerpt: w.workDesc ? w.workDesc.slice(0, 200) : null,
    noteType: workType(w.workType),
    author: { ref: w.accountUserid ?? null, displayName: w.accountNickname?.trim() || '작성자 미확인', followers: parseMetricValue(null) },
    publishedAt: parseCreateTime(w.workPublishTime),
    providerSnapshotAt: null,
    metrics: {
      likes: parseMetricValue(w.workLikedCount), saves: parseMetricValue(w.workCollectedCount), comments: parseMetricValue(w.workCommentsCount),
      shares: parseMetricValue(w.workSharedCount), views: parseMetricValue(w.workReadedCount),
    },
    providerTags: [...new Set(extractHashtags(w.workDesc))].slice(0, 30),
    coverUrl: safeCoverUrl(w.coverUrl),
    topics: [],
    formats: [],
  };
}
