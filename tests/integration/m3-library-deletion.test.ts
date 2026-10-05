import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createReference, enqueueDeletion, listLibrary, listMyDeletionRequests, listShareRequests, LocalPrivateStorage, publishReference, purgeExpired, requestDeletion,
  requestSharing, revokeSharing, runJob, unpublishReference, updateReference, uploadAsset, attachToReference, DELETE_CONFIRM_TEXT, type Ctx, type Runner,
} from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { ORG1, pool, U } from './db.ts';

const service: Runner = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); const o = await fn(c); await c.query('commit'); return o; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
async function as<T>(uid: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const role = (await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [ORG1, uid])).rows[0]?.role ?? 'student';
    const out = await fn({ db: c, uid, orgId: ORG1, role, mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
afterAll(async () => { await pool.end(); });

async function newStudent(email: string) {
  const id = (await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).rows[0].id as string;
  await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'student')`, [ORG1, id]);
  return id;
}

describe('library sharing', () => {
  it('needs consent, publishes an immutable snapshot, hides on revoke and on source edit stays old', async () => {
    const S = await newStudent('lib-student@demo.invalid');
    const ref = await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: '타인 글 전문(공유되면 안 됨)', title: '참고 글', memo: '도입부가 좋음', licenseAssertion: 'reference_only' }));
    await expect(as(S, (ctx) => requestSharing(ctx, ref, { confirm: false }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await as(U.reviewer, (ctx) => listShareRequests(ctx))).some((r) => r.referenceId === ref)).toBe(false);
    await as(S, (ctx) => requestSharing(ctx, ref, { confirm: true }));
    const req = (await as(U.reviewer, (ctx) => listShareRequests(ctx))).find((r) => r.referenceId === ref)!;
    expect(req).toMatchObject({ ownerEmail: 'lib-student@demo.invalid', title: '참고 글' });
    await expect(as(U.studentA, (ctx) => listShareRequests(ctx))).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const pub = await as(U.reviewer, (ctx) => publishReference(ctx, ref, req.revision));
    const lib = await as(U.studentB, (ctx) => listLibrary(ctx));
    const item = lib.find((l) => l.id === pub)!;
    expect(item).toMatchObject({ title: '참고 글', memo: '도입부가 좋음', userText: null }); // third-party text is not redistributed

    // Editing the source does not change the snapshot.
    await as(S, (ctx) => updateReference(ctx, ref, { memo: '수정된 메모', revision: req.revision }));
    expect((await as(U.studentB, (ctx) => listLibrary(ctx))).find((l) => l.id === pub)!.memo).toBe('도입부가 좋음');
    await expect(pool.query(`update reference_publications set snapshot_json = '{}' where id = $1`, [pub])).rejects.toThrow(/IMMUTABLE/);

    await as(S, (ctx) => revokeSharing(ctx, ref));
    expect((await as(U.studentB, (ctx) => listLibrary(ctx))).some((l) => l.id === pub)).toBe(false);
    await expect(as(U.reviewer, (ctx) => publishReference(ctx, ref, req.revision + 1))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('staff can unpublish; trashing the source hides publications', async () => {
    const S = await newStudent('lib-student2@demo.invalid');
    const r1 = await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: '내 글', title: '내 콘텐츠', licenseAssertion: 'own_content' }));
    await as(S, (ctx) => requestSharing(ctx, r1, { confirm: true }));
    const p1 = await as(U.admin, (ctx) => publishReference(ctx, r1, 1));
    expect((await as(U.studentB, (ctx) => listLibrary(ctx))).find((l) => l.id === p1)?.userText).toBe('내 글');
    await as(U.admin, (ctx) => unpublishReference(ctx, p1, '저작권 확인 필요'));
    expect((await as(U.studentB, (ctx) => listLibrary(ctx))).some((l) => l.id === p1)).toBe(false);

    const r2 = await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: 'x', title: '두 번째' }));
    await as(S, (ctx) => requestSharing(ctx, r2, { confirm: true }));
    const p2 = await as(U.reviewer, (ctx) => publishReference(ctx, r2, 1));
    await as(S, async (ctx) => { const { trashReference } = await import('@xhs/core'); await trashReference(ctx, r2, true); });
    expect((await as(U.studentB, (ctx) => listLibrary(ctx))).some((l) => l.id === p2)).toBe(false);
  });
});

describe('deletion request', () => {
  it('blocks access immediately, then deletes stored data and files; ledger/audit retained', async () => {
    const S = await newStudent('delete-me@demo.invalid');
    const storage = new LocalPrivateStorage(await mkdtemp(join(tmpdir(), 'xhs-del-')));
    const ref = await as(S, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: '지울 메모', title: '지울 자료' }));
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0]);
    const img = await as(S, (ctx) => uploadAsset(ctx, storage, { bytes: PNG, declaredMime: 'image/png', originalName: 'a.png', purpose: 'reference_image' }));
    await as(S, (ctx) => attachToReference(ctx, ref, img.id));
    await as(S, (ctx) => requestSharing(ctx, ref, { confirm: true }));
    const pub = await as(U.reviewer, (ctx) => publishReference(ctx, ref, 1));

    await expect(as(S, (ctx) => requestDeletion(ctx, '삭제'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const reqId = await as(S, (ctx) => requestDeletion(ctx, DELETE_CONFIRM_TEXT));
    // Immediate: library item gone.
    expect((await as(U.studentB, (ctx) => listLibrary(ctx))).some((l) => l.id === pub)).toBe(false);
    await service((db) => enqueueDeletion(db, reqId));
    const job = (await pool.query(`select id from app_jobs where kind = 'user_deletion' and owner_user_id = $1`, [S])).rows[0].id;
    expect(await runJob({ service, provider: new MockXhsProvider(), storage }, job, 't')).toMatchObject({ state: 'succeeded' });

    const left = (await pool.query(`select (select count(*) from reference_items where owner_user_id = $1)::int as refs, (select count(*) from assets where owner_user_id = $1)::int as assets,
      (select count(*) from reference_publications where source_owner_user_id = $1)::int as pubs`, [S])).rows[0];
    expect(left).toEqual({ refs: 0, assets: 0, pubs: 0 });
    await expect(storage.get(`${ORG1}/${img.id}`)).rejects.toThrow();
    const [req] = await as(S, (ctx) => listMyDeletionRequests(ctx));
    expect(req).toMatchObject({ state: 'partially_retained', summary: expect.objectContaining({ references: 1, assets: 1 }) });
    expect(req!.exceptionReason).toContain('보존');
  });

  it('expiry purge removes expired content only', async () => {
    await pool.query(`insert into notes (org_id, provider, platform_note_id, data_mode, canonical_url, provenance, expires_at) values ($1, 'mock', 'purge-me', 'mock', 'https://demo.invalid/n/p', '{}', now() - interval '1 day')`, [ORG1]);
    const r = await service((db) => purgeExpired(db));
    expect(r.notes).toBeGreaterThanOrEqual(1);
    expect((await pool.query(`select count(*)::int as n from notes where platform_note_id = 'purge-me'`)).rows[0].n).toBe(0);
  });
});
