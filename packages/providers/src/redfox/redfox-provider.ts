import type { TopicSlug } from '@xhs/domain';
import { assertFetchableUrl } from '@xhs/security';
import { REDFOX_BASE_URL, REDFOX_CAPABILITIES, type EndpointCapability, type EndpointId } from '../capabilities.ts';
import { evaluateLiveGate, LiveCallBlockedError, type LiveGateContext } from '../gate.ts';
import type { ProviderNote, SearchResult, TranscriptResult, TranscriptSubmit, XhsDataProvider } from '../types.ts';
import { REDFOX_SUCCESS, RedfoxEnvelope, Rf13Data, Rf14Data } from './schemas.ts';

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

/** True when an error is known to have happened before a request was sent. */
export function isNotSentError(e: unknown): boolean {
  return e instanceof LiveCallBlockedError || e instanceof ProviderNotReadyError;
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
  ) {}

  async searchNotes(_input: { query: string; topic?: TopicSlug; days?: 7 | 14 | 30 }): Promise<SearchResult> {
    this.assertAllowed('RF01');
    // No verified response contract yet (provider doc not received): refuse instead of guessing fields.
    throw new ProviderNotReadyError('RF01 response contract not verified');
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
    if (!res.ok) throw new ProviderBusinessError(res.status);
    const env = RedfoxEnvelope.safeParse(await res.json());
    if (!env.success) throw new ProviderContractError(`${id} envelope failed schema`);
    if (env.data.code !== REDFOX_SUCCESS) throw new ProviderBusinessError(env.data.code);
    return env.data.data;
  }
}
