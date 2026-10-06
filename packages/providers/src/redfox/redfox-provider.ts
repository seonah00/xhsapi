import { extractHashtags, parseMetricValue, type TopicSlug } from '@xhs/domain';
import { assertFetchableUrl, normalizeXhsNoteUrl } from '@xhs/security';
import { REDFOX_BASE_URL, REDFOX_CAPABILITIES, type EndpointCapability, type EndpointId } from '../capabilities.ts';
import { evaluateLiveGate, LiveCallBlockedError, type LiveGateContext } from '../gate.ts';
import type { ProviderNote, SearchResult, TranscriptResult, TranscriptSubmit, XhsDataProvider } from '../types.ts';
import type { z } from 'zod';
import { REDFOX_SUCCESS, RedfoxEnvelope, Rf01Data, Rf13Data, Rf14Data, type Rf01Article } from './schemas.ts';

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
  ) {}

  async searchNotes(input: { query: string; topic?: TopicSlug; days?: 7 | 14 | 30 }): Promise<SearchResult> {
    const keyword = input.query.trim();
    const body: Record<string, unknown> = keyword ? { keyword } : { pageNum: 1, pageSize: 20 }; // pageNum/pageSize apply only without a keyword
    if (input.days) {
      body.startDate = shanghaiDate(this.now(), -input.days);
      body.endDate = shanghaiDate(this.now(), 0);
    }
    const fetchedAt = this.now().toISOString();
    const parsed = Rf01Data.safeParse(await this.post('RF01', body, { bareAllowed: true }));
    if (!parsed.success) throw new ProviderContractError('RF01 response failed schema');
    const d = parsed.data;
    return {
      mode: 'live', endpoint: 'RF01', fetchedAt,
      notes: (d.articles ?? []).map(toNote).filter((x): x is ProviderNote => !!x),
      latestHotArticles: (d.latestHotArticles ?? []).map(toNote).filter((x): x is ProviderNote => !!x),
      relatedTerms: (d.relatedSearches ?? []).map((r) => r.keyword.trim()).filter((k) => k.length > 0 && k.length <= 40).slice(0, 20),
      // The provider has no topic filter; our topic classification is not applied to live notes yet.
      coverage: { requestedPages: 1, fetchedPages: 1, postFilters: input.topic ? ['topic_not_supported_by_provider'] : [] },
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

  private async post(id: EndpointId, body: unknown, opts: { bareAllowed?: boolean } = {}): Promise<unknown> {
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
    const json: unknown = await res.json();
    // RF01's doc example is the bare data object; a body without a numeric `code` is accepted only there.
    if (opts.bareAllowed && !(json && typeof json === 'object' && typeof (json as { code?: unknown }).code === 'number')) return json;
    const env = RedfoxEnvelope.safeParse(json);
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

/** "2026-07-08 13:05:29" without zone; read as China time (UTC+8) — to be confirmed in the first live test. */
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
    try { canonicalUrl = normalizeXhsNoteUrl(a.shareInfoLink).canonicalUrl; } catch { /* keep the id-based URL */ }
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
