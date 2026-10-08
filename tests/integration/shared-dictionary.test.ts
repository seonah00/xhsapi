import { afterAll, describe, expect, it } from 'vitest';
import type { Ctx } from '@xhs/core';
import {
  getDictionaryImport,
  getPublishedDictionaryEntries,
  listDictionaryImports,
  listSharedDictionary,
  publishDictionaryImport,
  reviewDictionaryImport,
  stageDictionaryImport,
} from '../../packages/core/src/shared-dictionary.ts';
import { ORG1, ORG2, pool, U } from './db.ts';

async function as<T>(
  uid: string,
  orgId: string,
  role: Ctx['role'],
  fn: (ctx: Ctx) => Promise<T>,
  mode: Ctx['mode'] = 'mock',
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const out = await fn({ db: c, uid, orgId, role, mode });
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const tag = (n: number, meaning = `합성 태그 뜻 ${n}`) => ({
  id: `SDT${String(n).padStart(4, '0')}`,
  entryType: 'tag',
  term: `synthetic-tag-${n}`,
  meaning,
  kind: n % 2 ? '주제' : '형식',
  categories: [n % 2 ? '뷰티' : '일상'],
  cautions: n % 7 === 0 ? ['합성 테스트 주의'] : [],
  groups: ['합성 그룹'],
  observation_count: (n % 9) + 1,
  trend_status: '유행 여부 미검증',
  examples: ['student must never receive this'],
  sourceIds: [`private-${n}`],
});

const expression = (n: number) => ({
  id: `SDE${String(n).padStart(4, '0')}`,
  entryType: 'expression',
  term: `합성 표현 ${n}`,
  meaning: `합성 표현 뜻 ${n}`,
  kind: '일상 말투',
  categories: ['일상'],
  cautions: [],
  groups: ['합성 표현 그룹'],
  observation_count: 1,
});

const payload = {
  metadata: { author: 'private fixture author' },
  tags: Array.from({ length: 327 }, (_, i) => i === 325 ? { ...tag(i + 1), term: 'GRWM' } : i === 326 ? { ...tag(i + 1), term: 'grwm' } : tag(i + 1)),
  expressions: Array.from({ length: 131 }, (_, i) => expression(i + 1)),
  sources: [{ id: 'private-source', url: 'https://private.invalid/source', quote: 'private raw quote' }],
};

let batchId = '';
let firstTagId = '';
let firstExpressionId = '';

afterAll(async () => {
  await pool.end();
});

describe('shared dictionary import permissions and workflow', () => {
  it('allows only org admins to stage and list private imports', async () => {
    await expect(as(U.studentA, ORG1, 'student', (ctx) => stageDictionaryImport(ctx, { label: 'blocked', payload })))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as(U.reviewer, ORG1, 'reviewer', (ctx) => listDictionaryImports(ctx)))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    batchId = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, { label: '합성 공용사전 1차', payload }));
    const detail = await as(U.admin, ORG1, 'org_admin', (ctx) => getDictionaryImport(ctx, batchId));
    expect(detail).toMatchObject({
      id: batchId,
      status: 'staged',
      counts: { tags: 327, expressions: 131, total: 458 },
      revision: 1,
    });
    expect(detail.preview.diff.counts).toEqual({ create: 458, update: 0, unchanged: 0 });
    expect(JSON.stringify(detail.rawPayload)).toContain('private raw quote');
    expect(JSON.stringify(detail.preview)).not.toContain('private raw quote');
    await expect(as(U.admin, ORG1, 'org_admin', (ctx) => ctx.db.query(
      `update dictionary_import_batches set raw_payload='{}'::jsonb, revision=revision+1 where id=$1`, [batchId],
    ))).rejects.toThrow(/DICTIONARY_IMPORT_IMMUTABLE/);
  });

  it('hides the batch table and raw JSON from students, reviewers, and other orgs at RLS level', async () => {
    for (const [uid, org, role] of [
      [U.studentA, ORG1, 'student'],
      [U.reviewer, ORG1, 'reviewer'],
      [U.admin2, ORG2, 'org_admin'],
    ] as const) {
      const seen = await as(uid, org, role, async (ctx) => (await ctx.db.query(
        `select id, raw_payload from dictionary_import_batches where id = $1`, [batchId],
      )).rows);
      expect(seen).toEqual([]);
    }
  });

  it('allows authorized private-source erasure and former-admin membership removal', async () => {
    const erasable = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: '삭제 가능한 비공개 원자료', payload: { tags: [tag(9001)], expressions: [] },
    }));
    for (const [uid, role] of [[U.studentA, 'student'], [U.reviewer, 'reviewer']] as const) {
      const denied = await as(uid, ORG1, role, (ctx) => ctx.db.query(
        `delete from dictionary_import_batches where id=$1`, [erasable],
      ));
      expect(denied.rowCount).toBe(0);
    }
    const deleted = await as(U.admin, ORG1, 'org_admin', (ctx) => ctx.db.query(
      `delete from dictionary_import_batches where id=$1`, [erasable],
    ));
    expect(deleted.rowCount).toBe(1);

    const formerAdmin = '00000000-0000-4000-a000-000000000099';
    await pool.query(`insert into auth.users(id,email) values($1,'former-admin@example.invalid')`, [formerAdmin]);
    await pool.query(`insert into memberships(org_id,user_id,role) values($1,$2,'org_admin')`, [ORG1, formerAdmin]);
    const historical = await as(formerAdmin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: '과거 관리자 원자료', payload: { tags: [tag(9002)], expressions: [] },
    }));
    expect((await pool.query(`delete from memberships where org_id=$1 and user_id=$2`, [ORG1, formerAdmin])).rowCount).toBe(1);
    expect((await pool.query(`select staged_by from dictionary_import_batches where id=$1`, [historical])).rows)
      .toEqual([{ staged_by: formerAdmin }]);
    const erasedBySuccessor = await as(U.admin, ORG1, 'org_admin', (ctx) => ctx.db.query(
      `delete from dictionary_import_batches where id=$1`, [historical],
    ));
    expect(erasedBySuccessor.rowCount).toBe(1);
    expect((await pool.query(`select id from dictionary_import_batches where id=$1`, [historical])).rows).toEqual([]);
  });

  it('requires stage -> review -> publish and explicit confirmation', async () => {
    await expect(as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, batchId, true))).rejects.toThrow();
    await expect(as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, batchId, false)))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, batchId, true));
    await expect(as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, batchId, true)))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, batchId, false)))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const result = await as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, batchId, true));
    expect(result).toEqual({
      batchId,
      counts: { tags: 327, expressions: 131, total: 458 },
      created: 458,
      updated: 0,
      unchanged: 0,
    });
    const detail = await as(U.admin, ORG1, 'org_admin', (ctx) => getDictionaryImport(ctx, batchId));
    expect(detail.status).toBe('published');
    expect(detail.revision).toBe(3);
    expect(detail.preview.diff.counts).toEqual({ create: 0, update: 0, unchanged: 458 });

    const reviewedRevision = (await pool.query<{ catalog_revision: string }>(
      `select catalog_revision from dictionary_import_batches where id=$1`, [batchId],
    )).rows[0]!.catalog_revision;
    expect(reviewedRevision).toMatch(/^[0-9a-f]{64}$/);
    const caseVariants = (await pool.query(
      `select canonical_text, raw_text, provenance, data_mode
         from keywords
        where org_id=$1 and data_mode='mock' and shared_dictionary_meta->>'term' in ('GRWM','grwm')
        order by raw_text`,
      [ORG1],
    )).rows;
    expect(caseVariants).toEqual([
      { canonical_text: 'grwm', raw_text: 'GRWM', provenance: 'editorial_seed', data_mode: 'mock' },
      { canonical_text: 'grwm', raw_text: 'grwm', provenance: 'editorial_seed', data_mode: 'mock' },
    ]);
  });

  it('publishes a reordered equivalent batch as fully unchanged', async () => {
    const reorderedPayload = {
      ...payload,
      tags: [...payload.tags].reverse(),
      expressions: [...payload.expressions].reverse(),
    };
    const reordered = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: '합성 공용사전 순서 변경 검증', payload: reorderedPayload,
    }));
    const preview = await as(U.admin, ORG1, 'org_admin', (ctx) => getDictionaryImport(ctx, reordered));
    expect(preview.preview.diff.counts).toEqual({ create: 0, update: 0, unchanged: 458 });
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, reordered, true));
    const result = await as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, reordered, true));
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 458 });
  });

  it('treats matching metadata with a retired status as an update', async () => {
    await pool.query(
      `update keywords set review_status='retired'
        where org_id=$1 and data_mode='mock' and shared_dictionary_meta->>'term'='synthetic-tag-2'`,
      [ORG1],
    );
    const next = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: 'retired 상태 재공개', payload: { tags: [tag(2)], expressions: [] },
    }));
    const preview = await as(U.admin, ORG1, 'org_admin', (ctx) => getDictionaryImport(ctx, next));
    expect(preview.preview.diff.counts).toEqual({ create: 0, update: 1, unchanged: 0 });
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, next, true));
    expect(await as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, next, true)))
      .toMatchObject({ created: 0, updated: 1, unchanged: 0 });
  });

  it('rejects an older reviewed batch after a newer reviewed batch changes the same mode catalog', async () => {
    const older = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: '오래된 검토본', payload: { tags: [tag(3, '오래된 검토 뜻')], expressions: [] },
    }));
    const newer = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: '새 검토본', payload: { tags: [tag(3, '최신 검토 뜻')], expressions: [] },
    }));
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, older, true));
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, newer, true));
    await as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, newer, true));

    await expect(as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, older, true)))
      .rejects.toMatchObject({ code: 'CONFLICT', messageKo: expect.stringMatching(/다시 가져와 검토/) });
    expect((await pool.query(`select status from dictionary_import_batches where id=$1`, [older])).rows[0])
      .toEqual({ status: 'reviewed' });
    // Search is substring-based, so synthetic-tag-30..39 and 300+ also match.
    const current = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { query: 'synthetic-tag-3', pageSize: 100 }));
    const exact = current.items.filter((entry) => entry.term === 'synthetic-tag-3');
    expect(exact).toHaveLength(1);
    expect(exact[0]!.meaning).toBe('최신 검토 뜻');
  });

  it('keeps mock and live imports isolated without changing provenance to avoid collisions', async () => {
    const liveBatch = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, {
      label: '합성 공용사전 live', payload,
    }), 'live');
    const livePreview = await as(U.admin, ORG1, 'org_admin', (ctx) => getDictionaryImport(ctx, liveBatch), 'live');
    expect(livePreview.preview.diff.counts).toEqual({ create: 458, update: 0, unchanged: 0 });
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, liveBatch, true), 'live');
    expect(await as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, liveBatch, true), 'live'))
      .toMatchObject({ created: 458, updated: 0, unchanged: 0 });

    const mockCatalog = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { pageSize: 1 }));
    const liveCatalog = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { pageSize: 1 }), 'live');
    expect(mockCatalog.counts).toEqual({ tags: 327, expressions: 131 });
    expect(liveCatalog.counts).toEqual({ tags: 327, expressions: 131 });
    const importedTags = (await pool.query(
      `select data_mode, provenance, count(*)::int as count
         from keywords where org_id=$1 and shared_dictionary_key is not null
        group by data_mode, provenance order by data_mode, provenance`,
      [ORG1],
    )).rows;
    expect(importedTags).toEqual([
      { data_mode: 'live', provenance: 'editorial_seed', count: 327 },
      { data_mode: 'mock', provenance: 'editorial_seed', count: 327 },
    ]);

    const mockTag = (await pool.query<{ id: string }>(
      `select id from keywords where org_id=$1 and data_mode='mock' and shared_dictionary_meta->>'term'='GRWM'`, [ORG1],
    )).rows[0]!.id;
    const liveTag = (await pool.query<{ id: string }>(
      `select id from keywords where org_id=$1 and data_mode='live' and shared_dictionary_meta->>'term'='GRWM'`, [ORG1],
    )).rows[0]!.id;
    expect(await as(U.studentA, ORG1, 'student', (ctx) => getPublishedDictionaryEntries(ctx, [liveTag]))).toEqual([]);
    expect(await as(U.studentA, ORG1, 'student', (ctx) => getPublishedDictionaryEntries(ctx, [mockTag]), 'live')).toEqual([]);
  });
});

describe('published shared dictionary', () => {
  it('makes all 327 synthetic tags queryable to students with max-100 pagination', async () => {
    const pages = [];
    for (let page = 1; page <= 4; page++) {
      pages.push(await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { entryType: 'tag', page, pageSize: 100 })));
    }
    expect(pages.map((p) => p.items.length)).toEqual([100, 100, 100, 27]);
    expect(pages[0]).toMatchObject({ total: 327, counts: { tags: 327, expressions: 131 } });
    const all = pages.flatMap((p) => p.items);
    expect(new Set(all.map((entry) => entry.id)).size).toBe(327);
    firstTagId = all[0]!.id;
    const expressionPage = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { entryType: 'expression', pageSize: 1 }));
    firstExpressionId = expressionPage.items[0]!.id;
    const serialized = JSON.stringify(all[0]);
    for (const forbidden of ['examples', 'sourceIds', 'private-', 'url', 'quote', 'author', 'raw']) expect(serialized).not.toContain(forbidden);
  });

  it('supports public query/category filters and sanitized ID lookup', async () => {
    const filtered = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, {
      query: 'synthetic-tag-1', category: '뷰티', pageSize: 100,
    }));
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((entry) => entry.categories.includes('뷰티'))).toBe(true);

    const entries = await as(U.studentA, ORG1, 'student', (ctx) => getPublishedDictionaryEntries(ctx, [firstTagId]));
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]!).sort()).toEqual([
      'categories', 'cautions', 'entryType', 'groups', 'id', 'meaning', 'observedCount', 'term', 'type', 'unknownTrendNote',
    ].sort());
    expect(await as(U.admin2, ORG2, 'org_admin', (ctx) => getPublishedDictionaryEntries(ctx, [firstTagId]))).toEqual([]);
  });

  it('allows students to read published rows but only admins to mutate imported rows', async () => {
    const keywordUpdate = await as(U.reviewer, ORG1, 'reviewer', (ctx) => ctx.db.query(
      `update keywords set meaning_ko='reviewer edit' where id=$1`, [firstTagId],
    ));
    const expressionUpdate = await as(U.reviewer, ORG1, 'reviewer', (ctx) => ctx.db.query(
      `update expressions set expression='reviewer edit' where id=$1`, [firstExpressionId],
    ));
    expect(keywordUpdate.rowCount).toBe(0);
    expect(expressionUpdate.rowCount).toBe(0);
  });

  it('hides draft keywords from students but preserves reviewer/admin visibility', async () => {
    const draftId = (await pool.query<{ id: string }>(
      `insert into keywords (org_id, canonical_text, raw_text, kind, provenance, data_mode, review_status)
       values ($1, 'synthetic-hidden-draft', 'synthetic-hidden-draft', 'hashtag', 'editorial_seed', 'mock', 'draft') returning id`,
      [ORG1],
    )).rows[0]!.id;
    const studentRows = await as(U.studentA, ORG1, 'student', async (ctx) => (await ctx.db.query(`select id from keywords where id=$1`, [draftId])).rows);
    const reviewerRows = await as(U.reviewer, ORG1, 'reviewer', async (ctx) => (await ctx.db.query(`select id from keywords where id=$1`, [draftId])).rows);
    expect(studentRows).toEqual([]);
    expect(reviewerRows).toEqual([{ id: draftId }]);
  });

  it('upserts only a matching curated key and never retires unrelated published records', async () => {
    const unrelated = (await pool.query<{ id: string }>(
      `insert into keywords (org_id, canonical_text, raw_text, kind, provenance, data_mode, review_status)
       values ($1, 'unrelated-published', 'unrelated-published', 'hashtag', 'editorial_seed', 'mock', 'published') returning id`,
      [ORG1],
    )).rows[0]!.id;
    const updatePayload = { tags: [tag(1, '업데이트된 합성 뜻')], expressions: [] };
    const next = await as(U.admin, ORG1, 'org_admin', (ctx) => stageDictionaryImport(ctx, { label: '합성 공용사전 부분 갱신', payload: updatePayload }));
    const preview = await as(U.admin, ORG1, 'org_admin', (ctx) => getDictionaryImport(ctx, next));
    expect(preview.preview.diff.counts).toEqual({ create: 0, update: 1, unchanged: 0 });
    await as(U.admin, ORG1, 'org_admin', (ctx) => reviewDictionaryImport(ctx, next, true));
    const result = await as(U.admin, ORG1, 'org_admin', (ctx) => publishDictionaryImport(ctx, next, true));
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    const current = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { query: 'synthetic-tag-1', pageSize: 100 }));
    expect(current.items.some((entry) => entry.meaning === '업데이트된 합성 뜻')).toBe(true);
    expect((await pool.query(`select review_status from keywords where id=$1`, [unrelated])).rows[0]).toEqual({ review_status: 'published' });
    const finalCounts = await as(U.studentA, ORG1, 'student', (ctx) => listSharedDictionary(ctx, { pageSize: 1 }));
    expect(finalCounts).toMatchObject({ counts: { tags: 327, expressions: 131 } });
  });
});
