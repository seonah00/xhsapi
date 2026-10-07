import { z } from 'zod';

export const CollectionTarget = z.union([z.literal(50), z.literal(100)]);
/** Two spare pages allow for duplicate or date-filtered results without unbounded spend. */
export const collectionPages = (target: number): number => Math.ceil(CollectionTarget.parse(target) / 20) + 2;
export const EnrichmentScope = z.union([
  z.object({ noteId: z.string().uuid() }).strict(),
  z.object({ noteIds: z.array(z.string().uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length, '중복 노트는 선택할 수 없습니다.') }).strict(),
]);
export function enrichmentIds(scope: unknown): string[] {
  const s = EnrichmentScope.parse(scope);
  return 'noteId' in s ? [s.noteId] : s.noteIds;
}
export type CollectionProgress = { pages: number; noteIds: string[]; fingerprints: string[] };
export type CollectionStop = 'target_reached' | 'provider_exhausted' | 'repeated_page' | 'page_limit';
export function advanceCollection(previous: CollectionProgress, ids: string[], page: { rawCount?: number; hasMore?: boolean | null; pageFingerprint?: string }, target: number) {
  const pages = previous.pages + 1;
  const noteIds = [...new Set([...previous.noteIds, ...ids])];
  const repeated = !!page.pageFingerprint && previous.fingerprints.includes(page.pageFingerprint);
  const fingerprints = [...previous.fingerprints, ...(page.pageFingerprint ? [page.pageFingerprint] : [])];
  const stopReason: CollectionStop | null = noteIds.length >= target ? 'target_reached'
    : page.rawCount === 0 || page.hasMore === false ? 'provider_exhausted'
    : repeated ? 'repeated_page' : pages >= collectionPages(target) ? 'page_limit' : null;
  return { pages, noteIds, fingerprints, stopReason, targetCount: target, notes: noteIds.length };
}
