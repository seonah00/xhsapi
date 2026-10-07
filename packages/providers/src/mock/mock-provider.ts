import { sha256Hex } from '@xhs/domain';
import type { ProviderNote, SearchResult, TranscriptResult, TranscriptSubmit, XhsDataProvider } from '../types.ts';
import { EMPTY_QUERY, MOCK_LATEST_HOT, MOCK_NOTES, MOCK_RELATED_TERMS, MOCK_TRANSCRIPTS, genericTranscript } from './fixtures.ts';

export type MockProviderOptions = {
  /** Fixed clock for deterministic tests. */
  now?: () => Date;
  /** Number of result polls that report `processing` before completing (in-process tests). */
  transcriptPollsUntilDone?: number;
  /** For tasks this instance did not submit (e.g. after a worker restart): processing time from the submit timestamp in the task id. */
  transcriptProcessingMs?: number;
};

/** Deterministic in-memory provider. Performs no network I/O by construction. */
export class MockXhsProvider implements XhsDataProvider {
  readonly mode = 'mock' as const;
  private readonly now: () => Date;
  private readonly pollsUntilDone: number;
  private readonly processingMs: number;
  private readonly tasks = new Map<string, { noteId: string; polls: number }>();

  constructor(opts: MockProviderOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.pollsUntilDone = opts.transcriptPollsUntilDone ?? 1;
    this.processingMs = opts.transcriptProcessingMs ?? 2000;
  }

  async searchNotes(input: { query: string; topic?: SearchResult['notes'][number]['topics'][number]; days?: 7 | 14 | 30; offset?: number }): Promise<SearchResult> {
    const fetchedAt = this.now().toISOString();
    const q = input.query.trim();
    const base: SearchResult = {
      mode: 'mock', endpoint: 'mock:RF01', fetchedAt, notes: [], relatedTerms: [],
      latestHotArticles: [...MOCK_LATEST_HOT],
      coverage: { requestedPages: 1, fetchedPages: 1, postFilters: input.days ? ['published_within_days'] : [] },
    };
    if (q === EMPTY_QUERY) return base;

    const cutoff = input.days ? this.now().getTime() - input.days * 86_400_000 : null;
    const seen = new Set<string>();
    const notes: ProviderNote[] = [];
    for (const note of MOCK_NOTES) {
      if (input.topic && !note.topics.includes(input.topic)) continue;
      if (q && !matches(note, q)) continue;
      // Unknown publish date can't satisfy a date filter.
      if (cutoff !== null && (note.publishedAt === null || Date.parse(note.publishedAt) < cutoff)) continue;
      if (seen.has(note.platformNoteId)) continue;
      seen.add(note.platformNoteId);
      notes.push(note);
    }
    return { ...base, notes, relatedTerms: (input.topic && MOCK_RELATED_TERMS[input.topic]) || [] };
  }

  async noteDetail(input: { platformNoteId: string }): Promise<ProviderNote | null> {
    return MOCK_NOTES.find((n) => n.platformNoteId === input.platformNoteId) ?? null;
  }

  async submitTranscript(input: { platformNoteId: string; accessUrl: string }): Promise<TranscriptSubmit> {
    // Stateless task id: note id + submit time, so any worker instance can answer the poll.
    const taskId = `mock.${input.platformNoteId}.${this.now().getTime()}.${sha256Hex(input.platformNoteId).slice(0, 8)}`;
    this.tasks.set(taskId, { noteId: input.platformNoteId, polls: 0 });
    return { taskId };
  }

  async transcriptResult(input: { taskId: string }): Promise<TranscriptResult> {
    const task = this.tasks.get(input.taskId);
    let noteId: string;
    if (task) {
      task.polls += 1;
      if (task.polls <= this.pollsUntilDone) return { status: 'processing', taskId: input.taskId };
      noteId = task.noteId;
    } else {
      const m = /^mock\.([^.]+)\.(\d+)\.[0-9a-f]{8}$/.exec(input.taskId);
      if (!m?.[1] || !m[2]) return { status: 'failed', taskId: input.taskId, failCode: 'unknown' };
      if (this.now().getTime() - Number(m[2]) < this.processingMs) return { status: 'processing', taskId: input.taskId };
      noteId = m[1];
    }

    const note = MOCK_NOTES.find((n) => n.platformNoteId === noteId);
    if (!note || note.noteType !== 'video') return { status: 'failed', taskId: input.taskId, failCode: 'not_video' };
    const c = MOCK_TRANSCRIPTS[note.platformNoteId] ?? genericTranscript(note);
    if (c.kind === 'no_speech') return { status: 'failed', taskId: input.taskId, failCode: 'no_speech_detected' };
    if (c.kind === 'failed') return { status: 'failed', taskId: input.taskId, failCode: 'provider_failed' };
    return { status: 'succeeded', taskId: input.taskId, text: c.segments.map((s) => s.text).join(''), segments: c.segments };
  }
}

function matches(note: ProviderNote, q: string): boolean {
  // Substring match: Chinese has no whitespace word boundaries (spec 2).
  const hay = [note.title, note.bodyExcerpt, ...note.providerTags].filter(Boolean).join('\n').toLowerCase();
  return hay.includes(q.toLowerCase());
}
