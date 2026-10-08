import { describe, expect, it } from 'vitest';
import { normalizeDictionaryImport } from '../../packages/core/src/shared-dictionary.ts';

function tag(id = 'T001') {
  return {
    id,
    entryType: 'tag',
    term: '敏感肌',
    meaning: '민감성 피부 관련 태그',
    kind: '주제',
    categories: ['공통'],
    mainCategories: ['뷰티', ' 뷰티 ', '스킨케어'],
    cautions: ['의학적 효능으로 단정하지 않기'],
    groups: ['피부타입'],
    observation_count: 4,
    trend_status: '유행 여부 미검증',
    examples: ['공개하면 안 되는 예시'],
    sourceIds: ['private-source'],
    url: 'https://private.invalid/source',
  };
}

function expression(id = 'E001') {
  return {
    id,
    entryType: 'expression',
    term: '狠狠爱住',
    meaning: '매우 마음에 든다는 인터넷식 표현',
    kind: '인터넷 표현',
    categories: ['일상'],
    cautions: [],
    groups: ['강조'],
    observedCount: 2,
  };
}

describe('normalizeDictionaryImport', () => {
  it('returns only the curated allowlist and bounded counts', () => {
    const out = normalizeDictionaryImport({
      metadata: { author: 'private' },
      tags: [tag()],
      expressions: [expression()],
      sources: [{ url: 'https://private.invalid', quote: 'private' }],
    });
    expect(out.counts).toEqual({ tags: 1, expressions: 1, total: 2 });
    expect(out.entries[0]).toEqual({
      canonicalKey: expect.stringMatching(/^tag:敏感肌:[a-f0-9]{16}$/),
      entryType: 'tag',
      term: '敏感肌',
      meaning: '민감성 피부 관련 태그',
      type: '주제',
      categories: ['뷰티', '스킨케어'],
      cautions: ['의학적 효능으로 단정하지 않기'],
      groups: ['피부타입'],
      observedCount: 4,
      unknownTrendNote: '유행 여부 미검증',
    });
    const serialized = JSON.stringify(out);
    for (const forbidden of ['examples', 'sourceIds', 'private-source', 'private.invalid', 'author', 'quote']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps canonical identities stable under input reordering without publishing raw source IDs', () => {
    const variants = [
      { ...tag('private-source-a'), term: 'GRWM', meaning: 'upper' },
      { ...tag('private-source-b'), term: 'grwm', meaning: 'lower' },
      { ...tag('private-source-c'), term: 'WeeklyPick', meaning: 'first exact duplicate' },
      { ...tag('private-source-d'), term: 'WeeklyPick', meaning: 'second exact duplicate' },
    ];
    const first = normalizeDictionaryImport({ tags: variants, expressions: [] });
    const reversed = normalizeDictionaryImport({ tags: [...variants].reverse(), expressions: [] });
    const keyed = (entries: typeof first.entries) => Object.fromEntries(entries.map((entry) => [`${entry.term}:${entry.meaning}`, entry.canonicalKey]));
    expect(keyed(reversed.entries)).toEqual(keyed(first.entries));
    expect(new Set(first.entries.map((entry) => entry.canonicalKey)).size).toBe(4);
    expect(JSON.stringify(first)).not.toContain('private-source');
  });

  it('preserves canonical case variants without using private source IDs as their identity', () => {
    const first = normalizeDictionaryImport({
      tags: [
        { ...tag('source-a'), term: 'GRWM', meaning: 'upper' },
        { ...tag('source-b'), term: 'grwm', meaning: 'lower' },
      ],
      expressions: [],
    });
    const replacedSourceIds = normalizeDictionaryImport({
      tags: [
        { ...tag('different-a'), term: 'GRWM', meaning: 'upper' },
        { ...tag('different-b'), term: 'grwm', meaning: 'lower' },
      ],
      expressions: [],
    });
    expect(first.entries.map((entry) => entry.canonicalKey)).toEqual(
      replacedSourceIds.entries.map((entry) => entry.canonicalKey),
    );
    expect(first.entries[0]!.canonicalKey).not.toBe(first.entries[1]!.canonicalKey);
  });

  it('rejects an entryType that conflicts with its collection', () => {
    expect(() => normalizeDictionaryImport({ tags: [{ ...tag(), entryType: 'expression' }], expressions: [] }))
      .toThrowError(/VALIDATION_FAILED/);
  });

  it('enforces the 10,000 entry bound', () => {
    const tags = Array.from({ length: 10_001 }, (_, i) => tag(`T${i}`));
    expect(() => normalizeDictionaryImport({ tags, expressions: [] })).toThrowError(/VALIDATION_FAILED/);
  });

  it('enforces the 2MB raw payload bound before retaining any source text', () => {
    expect(() => normalizeDictionaryImport({ tags: [], expressions: [], sources: [{ body: 'x'.repeat(2 * 1024 * 1024) }] }))
      .toThrowError(/VALIDATION_FAILED/);
  });

  it('rejects malformed collections rather than guessing a schema', () => {
    for (const raw of [null, {}, { tags: 'not-an-array', expressions: [] }, { tags: [], expressions: [{}] }]) {
      expect(() => normalizeDictionaryImport(raw)).toThrowError(/VALIDATION_FAILED/);
    }
  });
});
