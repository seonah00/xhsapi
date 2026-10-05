import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attachToPlan, createAccount, createPlan, deleteAsset, getPlan, getSubmission, LocalPrivateStorage, readAsset, runCheck, saveVersion, submitPlan,
  uploadAsset, withdrawSubmission, type Ctx, type Runner,
} from '@xhs/core';
import { COHORT1, ORG1, pool, U } from './db.ts';

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
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (t: string, d: number[]) => [...u32(d.length), ...[...t].map((c) => c.charCodeAt(0)), ...d, 0, 0, 0, 0];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...u32(4), ...u32(3), 8, 2, 0, 0, 0]),
  ...chunk('tEXt', [...'Location\0Seoul Mapo'].map((c) => c.charCodeAt(0))), ...chunk('IDAT', [1]), ...chunk('IEND', [])]);

let storage: LocalPrivateStorage;
let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'xhs-assets-')); storage = new LocalPrivateStorage(root); });
afterAll(async () => { await pool.end(); });

describe('private assets', () => {
  it('stores a sanitized copy privately and only the owner can read it', async () => {
    const a = await as(U.studentA, (ctx) => uploadAsset(ctx, storage, { bytes: PNG, declaredMime: 'image/png', originalName: '../내 사진.png', purpose: 'reference_image' }));
    expect(a).toMatchObject({ width: 4, height: 3, originalName: '내 사진.png' });
    const files = await readdir(join(root, ORG1));
    const onDisk = await readFile(join(root, ORG1, files[0]!));
    expect(onDisk.includes('Seoul Mapo')).toBe(false);
    expect((await as(U.studentA, (ctx) => readAsset(ctx, storage, a.id))).mime).toBe('image/png');
    for (const uid of [U.studentB, U.reviewer, U.admin]) await expect(as(uid, (ctx) => readAsset(ctx, storage, a.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await as(U.studentA, (ctx) => deleteAsset(ctx, storage, a.id));
    await expect(as(U.studentA, (ctx) => readAsset(ctx, storage, a.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects disguised files and evidence uploads by non-admins', async () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    await expect(as(U.studentA, (ctx) => uploadAsset(ctx, storage, { bytes: svg, declaredMime: 'image/png', originalName: 'x.png', purpose: 'reference_image' }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(as(U.studentA, (ctx) => uploadAsset(ctx, storage, { bytes: PNG, declaredMime: 'image/png', originalName: 'x.png', purpose: 'permission_evidence' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const ev = await as(U.admin, (ctx) => uploadAsset(ctx, storage, { bytes: new TextEncoder().encode('%PDF-1.4 contract'), declaredMime: 'application/pdf', originalName: '계약.pdf', purpose: 'permission_evidence' }));
    expect((await as(U.admin, (ctx) => readAsset(ctx, storage, ev.id))).mime).toBe('application/pdf');
    await expect(as(U.reviewer, (ctx) => readAsset(ctx, storage, ev.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reviewers read submitted attachments only while the submission is active', async () => {
    // Dedicated student so this test does not depend on accounts other files create.
    const S = '00000000-0000-4000-a000-0000000000cc';
    await pool.query(`insert into auth.users (id, email) values ($1, 'asset-student@demo.invalid') on conflict do nothing`, [S]);
    await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'student') on conflict do nothing`, [ORG1, S]);
    await pool.query(`insert into cohort_members (org_id, cohort_id, user_id, role) values ($1, $2, $3, 'student') on conflict do nothing`, [ORG1, COHORT1, S]);
    const accountId = await as(S, (ctx) => createAccount(ctx, { displayName: '첨부', topics: ['beauty'], mainTopic: 'beauty', audience: 'x', goals: ['record_life'], tone: 'plain', formats: ['vlog'], chineseLevel: 'beginner', showFace: false, useVoice: false }));
    const planId = await as(S, (ctx) => createPlan(ctx, { accountId, title: '첨부 기획' }));
    const shareable = await as(S, (ctx) => uploadAsset(ctx, storage, { bytes: PNG, declaredMime: 'image/png', originalName: 'shot.png', purpose: 'submission_attachment' }));
    const privateImg = await as(S, (ctx) => uploadAsset(ctx, storage, { bytes: PNG, declaredMime: 'image/png', originalName: 'private.png', purpose: 'reference_image' }));
    await as(S, (ctx) => attachToPlan(ctx, planId, shareable.id));
    const p = await as(S, (ctx) => getPlan(ctx, planId));
    const v = await as(S, (ctx) => saveVersion(ctx, planId, p.revision));
    const run = await as(S, (ctx) => runCheck(ctx, service, {}, { planId, versionId: v.id }));
    await expect(as(S, (ctx) => submitPlan(ctx, { planVersionId: v.id, cohortId: COHORT1, checkRunId: run, assetIds: [privateImg.id] }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const sub = await as(S, (ctx) => submitPlan(ctx, { planVersionId: v.id, cohortId: COHORT1, checkRunId: run, assetIds: [shareable.id] }));
    expect((await as(U.reviewer, (ctx) => getSubmission(ctx, sub))).attachments).toEqual([{ id: shareable.id, name: 'shot.png', mime: 'image/png' }]);
    expect((await as(U.reviewer, (ctx) => readAsset(ctx, storage, shareable.id))).bytes.length).toBeGreaterThan(0);
    await expect(as(U.reviewerOther, (ctx) => readAsset(ctx, storage, shareable.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await as(S, (ctx) => withdrawSubmission(ctx, sub));
    await expect(as(U.reviewer, (ctx) => readAsset(ctx, storage, shareable.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
