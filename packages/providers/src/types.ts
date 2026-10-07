import type { DataMode, FormatSlug, MetricValue, TopicSlug } from '@xhs/domain';

export type ProviderNote = {
  platformNoteId: string;
  canonicalUrl: string;
  title: string | null;
  bodyExcerpt: string | null;
  /** null when the provider does not say (e.g. RF01 search has no type field); never guessed. */
  noteType: 'video' | 'image' | null;
  /** ref is null when the provider omits the author id (never invented). */
  author: { ref: string | null; displayName: string; followers: MetricValue };
  publishedAt: string | null;
  /** Provider-side snapshot time if given; distinct from our fetch time. */
  providerSnapshotAt: string | null;
  metrics: { likes: MetricValue; saves: MetricValue; comments: MetricValue; shares: MetricValue; views: MetricValue };
  providerTags: string[];
  /** Provider cover image URL (RF02); shown by the browser only with media-display permission, never downloaded. */
  coverUrl?: string | null;
  topics: TopicSlug[];
  formats: FormatSlug[];
};

export type SearchResult = {
  mode: DataMode;
  endpoint: string;
  fetchedAt: string;
  notes: ProviderNote[];
  relatedTerms: string[];
  /** Spec F04: shown separately, excluded from recommendations and aggregates. */
  latestHotArticles: ProviderNote[];
  /** providerTotal/providerTip: what the provider says it matched (RF01 `total`/`tips`), which can exceed what it returned. */
  coverage: {
    requestedPages: number; fetchedPages: number; postFilters: string[]; providerTotal?: number | null; providerTip?: string | null;
    /** Cover diagnostics (hosts only, never full URLs): kept, absent, or refused because the host is not an XHS image CDN. */
    covers?: { kept: number; missing: number; expired: number; refusedHosts: Record<string, number> };
  };
};

export type TranscriptSubmit = { taskId: string };

export type TranscriptSegment = { seq: number; startMs: number; endMs: number; text: string };

export type TranscriptResult =
  | { status: 'processing'; taskId: string }
  | { status: 'succeeded'; taskId: string; text: string; segments: TranscriptSegment[] }
  | { status: 'failed'; taskId: string; failCode: 'provider_failed' | 'not_video' | 'no_speech_detected' | 'unknown' };

export interface XhsDataProvider {
  readonly mode: DataMode;
  searchNotes(input: { query: string; topic?: TopicSlug; days?: 7 | 14 | 30 }): Promise<SearchResult>;
  noteDetail(input: { platformNoteId: string }): Promise<ProviderNote | null>;
  submitTranscript(input: { platformNoteId: string; accessUrl: string }): Promise<TranscriptSubmit>;
  transcriptResult(input: { taskId: string }): Promise<TranscriptResult>;
}
