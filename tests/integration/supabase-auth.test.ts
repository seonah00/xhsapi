import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthError, createInvitation, invitationPreview, passwordProblem, resettableMemberEmail, SupabaseAuth, SupabaseStorage, type Ctx } from '@xhs/core';
import { bootstrapOrg } from '../../scripts/bootstrap-org.ts';
import { FAKE_ANON_KEY, FAKE_SERVICE_KEY, startFakeSupabase } from '../support/fake-supabase.ts';
import { ORG1, ORG2, pool, U } from './db.ts';

let fake: Awaited<ReturnType<typeof startFakeSupabase>>;
let auth: SupabaseAuth;
beforeAll(async () => {
  fake = await startFakeSupabase(process.env.DATABASE_URL!);
  auth = new SupabaseAuth(fake.url, FAKE_ANON_KEY, FAKE_SERVICE_KEY);
});
afterAll(async () => { await fake.close(); await pool.end(); });

async function asAdmin<T>(uid: string, org: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const out = await fn({ db: c, uid, orgId: org, role: 'org_admin', mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

describe('Supabase Auth client (against the local fake)', () => {
  it('invite-only account, one-time password link, sign-in', async () => {
    const email = `new-${Date.now()}@example.invalid`;
    const { userId } = await auth.createUser(email);
    expect((await pool.query(`select email from auth.users where id = $1`, [userId])).rows[0].email).toBe(email);
    await expect(auth.createUser(email, 'another-password-1')).rejects.toMatchObject({ kind: 'email_taken' });
    expect(await auth.signInWithPassword(email, 'anything-123')).toBeNull(); // no password yet

    const token = await auth.recoveryTokenHash(email);
    await auth.setPasswordWithToken(token, 'a-long-password-1');
    await expect(auth.setPasswordWithToken(token, 'second-try-12345')).rejects.toMatchObject({ kind: 'invalid_token' }); // one-time
    expect(await auth.signInWithPassword(email, 'a-long-password-1')).toEqual({ userId });
    expect(await auth.signInWithPassword(email, 'wrong-password-1')).toBeNull();
    // Keys travel only as headers to the configured project URL.
    expect(fake.requests.every((r) => r.path.startsWith('/auth/v1/') || r.path.startsWith('/storage/v1/'))).toBe(true);
  });

  it('reports an unreachable auth service as unavailable, not as a wrong password', async () => {
    const down = new SupabaseAuth('http://127.0.0.1:9', FAKE_ANON_KEY, FAKE_SERVICE_KEY);
    await expect(down.signInWithPassword('a@b.invalid', 'x')).rejects.toBeInstanceOf(AuthError);
  });

  it('password policy', () => {
    expect(passwordProblem('short')).toMatch(/10자/);
    expect(passwordProblem('minsu-password-2026', 'minsu@example.com')).toMatch(/이메일/);
    expect(passwordProblem('비밀번호'.repeat(7))).toMatch(/72/);
    expect(passwordProblem('correct-horse-battery')).toBeNull();
  });
});

describe('Supabase private storage client', () => {
  it('puts, reads and removes objects with the service key; rejects malformed keys', async () => {
    const s = new SupabaseStorage(fake.url, FAKE_SERVICE_KEY, 'private-assets');
    const key = `${ORG1}/${crypto.randomUUID()}`;
    await s.put(key, new Uint8Array([1, 2, 3]));
    await expect(s.put(key, new Uint8Array([9]))).rejects.toThrow(); // no silent overwrite
    expect([...(await s.get(key))]).toEqual([1, 2, 3]);
    await s.remove(key);
    await expect(s.get(key)).rejects.toThrow();
    await expect(s.put('../etc/passwd', new Uint8Array([1]))).rejects.toThrow('invalid storage key');
    await expect(new SupabaseStorage(fake.url, FAKE_ANON_KEY, 'private-assets').get(key)).rejects.toThrow(); // anon key cannot read
  });
});

describe('bootstrap and admin password links', () => {
  it('creates the first org and admin with a one-time link; refuses a duplicate org name', async () => {
    const c = await pool.connect();
    try {
      const r = await bootstrapOrg({ orgName: `부트스트랩 ${Date.now()}`, adminEmail: `ops-${Date.now()}@example.invalid` }, { db: c, auth, baseUrl: 'https://studio.example.com/' });
      expect(r.link).toMatch(/^https:\/\/studio\.example\.com\/auth\/set-password\?token=[0-9a-f]+$/);
      expect((await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [r.orgId, r.userId])).rows[0].role).toBe('org_admin');
      const name = (await c.query(`select name from organizations where id = $1`, [r.orgId])).rows[0].name;
      await expect(bootstrapOrg({ orgName: name, adminEmail: 'x@example.invalid' }, { db: c, auth, baseUrl: 'https://s.example.com' })).rejects.toThrow('이미');
    } finally { c.release(); }
  });

  it('an admin may issue a link only for members who belong to no other org', async () => {
    expect(await asAdmin(U.admin, ORG1, (ctx) => resettableMemberEmail(ctx, U.studentA))).toBe('student-a@demo.invalid');
    const both = (await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`two-orgs-${Date.now()}@example.invalid`])).rows[0].id;
    await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $3, 'student'), ($2, $3, 'student')`, [ORG1, ORG2, both]);
    await expect(asAdmin(U.admin, ORG1, (ctx) => resettableMemberEmail(ctx, both))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(asAdmin(U.admin, ORG1, (ctx) => resettableMemberEmail(ctx, U.admin))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(asAdmin(U.admin, ORG1, (ctx) => resettableMemberEmail(ctx, U.studentC))).rejects.toMatchObject({ code: 'NOT_FOUND' }); // other org's member
    await expect(asAdmin(U.studentA, ORG1, (ctx) => resettableMemberEmail({ ...ctx, role: 'student' }, U.studentB))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await pool.query(`select count(*)::int as n from audit_events where org_id = $1 and action = 'member.password_link_issued'`, [ORG1])).rows[0].n).toBeGreaterThan(0);
  });

  it('invitation preview by token reveals org name/role only while valid', async () => {
    const { token } = await asAdmin(U.admin, ORG1, (ctx) => createInvitation(ctx, { role: 'student', email: 'bound@example.invalid' }));
    const c = await pool.connect();
    try {
      expect(await invitationPreview(c, token)).toMatchObject({ role: 'student', email: 'bound@example.invalid', valid: true });
      expect(await invitationPreview(c, 'x'.repeat(40))).toBeNull();
      expect(await invitationPreview(c, "'; drop table x; --")).toBeNull();
    } finally { c.release(); }
  });
});

describe('post-deploy database check', () => {
  it('passes on a migrated database (demo data allowed here) and flags demo users otherwise', async () => {
    const { verifyDb } = await import('../../scripts/verify-db.ts');
    const c = await pool.connect();
    try {
      const all = await verifyDb(c, { allowDemo: true });
      expect(all.filter((x) => !x.ok)).toEqual([]);
      const strict = await verifyDb(c);
      expect(strict.find((x) => x.name.startsWith('데모 계정 없음'))?.ok).toBe(false);
    } finally { c.release(); }
  });
});
