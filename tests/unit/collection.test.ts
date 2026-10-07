import { describe, expect, it } from 'vitest';
import { advanceCollection, collectionPages, EnrichmentScope } from '@xhs/domain';

describe('bounded collection progress', () => {
  it('collects 50 unique notes over three pages and never pads or counts duplicates', () => {
    let p = { pages: 0, noteIds: [] as string[], fingerprints: [] as string[] };
    for (let page = 0; page < 3; page++) {
      const ids = Array.from({ length: 20 }, (_, i) => `id-${page * 15 + i}`);
      const r = advanceCollection(p, ids, { rawCount: 20, hasMore: true, pageFingerprint: `page-${page}` }, 50);
      if (page < 2) expect(r.stopReason).toBeNull();
      else { expect(r.stopReason).toBe('target_reached'); expect(r.noteIds).toHaveLength(50); }
      p = r;
    }
  });
  it('continues after date-filtered empty results, but stops for exhaustion, duplicate pages and the cost cap', () => {
    const p = { pages: 0, noteIds: [], fingerprints: [] };
    expect(advanceCollection(p, [], { rawCount: 20, hasMore: true, pageFingerprint: 'a' }, 50).stopReason).toBeNull();
    expect(advanceCollection(p, [], { rawCount: 0, hasMore: true, pageFingerprint: 'a' }, 50).stopReason).toBe('provider_exhausted');
    expect(advanceCollection(p, ['a'], { rawCount: 1, hasMore: false, pageFingerprint: 'a' }, 50).stopReason).toBe('provider_exhausted');
    expect(advanceCollection({ ...p, fingerprints: ['a'] }, [], { rawCount: 20, hasMore: true, pageFingerprint: 'a' }, 50).stopReason).toBe('repeated_page');
    expect(advanceCollection({ ...p, pages: collectionPages(50) - 1 }, [], { rawCount: 20, hasMore: true, pageFingerprint: 'a' }, 50).stopReason).toBe('page_limit');
  });
  it('limits enrichment to 50 unique, valid note IDs and keeps the single-note path', () => {
    const id = '00000000-0000-4000-a000-000000000001';
    expect(EnrichmentScope.parse({ noteId: id })).toEqual({ noteId: id });
    expect(EnrichmentScope.parse({ noteIds: [id] })).toEqual({ noteIds: [id] });
    for (const scope of [{ noteIds: [] }, { noteIds: [id, id] }, { noteIds: Array(51).fill(id) }, { noteIds: ['bad'] }, { noteId: id, noteIds: [id] }]) {
      expect(EnrichmentScope.safeParse(scope).success).toBe(false);
    }
  });
});
