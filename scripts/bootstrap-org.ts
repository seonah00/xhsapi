/**
 * Creates the first organization and its first org_admin in a real deployment
 * (Supabase Auth). Prints a one-time password link; no e-mail is sent.
 *
 *   pnpm bootstrap:org --org-name "샤오홍슈 클래스" --admin-email admin@example.com
 *
 * Needs DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY and APP_BASE_URL. Demo data is never created here.
 */
import pg from 'pg';
import { AuthError, SupabaseAuth } from '@xhs/core';
import { loadEnv } from '@xhs/domain';
import { parseArgs } from './price.ts';

export async function bootstrapOrg(opts: { orgName: string; adminEmail: string }, deps: { db: pg.ClientBase; auth: SupabaseAuth; baseUrl: string }) {
  const name = opts.orgName.trim();
  const email = opts.adminEmail.trim().toLowerCase();
  if (name.length < 2 || name.length > 80) throw new Error('--org-name: 2~80자');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--admin-email 형식 오류');
  if ((await deps.db.query(`select 1 from organizations where name = $1`, [name])).rowCount) throw new Error('같은 이름의 조직이 이미 있습니다.');
  let userId: string;
  try {
    userId = (await deps.auth.createUser(email)).userId;
  } catch (e) {
    if (!(e instanceof AuthError && e.kind === 'email_taken')) throw e;
    const row = (await deps.db.query(`select id from auth.users where lower(email) = $1`, [email])).rows[0];
    if (!row) throw new Error('Auth에는 있는데 DB에서 사용자를 찾을 수 없습니다.');
    userId = row.id;
  }
  await deps.db.query('begin');
  try {
    const orgId = (await deps.db.query<{ id: string }>(`insert into organizations (name) values ($1) returning id`, [name])).rows[0]!.id;
    await deps.db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'org_admin')`, [orgId, userId]);
    await deps.db.query(`select app.audit($1, 'org.bootstrapped', 'organization', $1, '{}'::jsonb)`, [orgId]);
    await deps.db.query('commit');
    const hash = await deps.auth.recoveryTokenHash(email);
    return { orgId, userId, link: `${deps.baseUrl.replace(/\/$/, '')}/auth/set-password?token=${encodeURIComponent(hash)}` };
  } catch (e) {
    await deps.db.query('rollback').catch(() => undefined);
    throw e;
  }
}

async function main() {
  const { opts } = parseArgs(['run', ...process.argv.slice(2)]);
  const env = loadEnv({ ...process.env, AUTH_PROVIDER: 'supabase' });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const r = await bootstrapOrg({ orgName: opts['org-name'] ?? '', adminEmail: opts['admin-email'] ?? '' }, {
      db, auth: new SupabaseAuth(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, env.SUPABASE_SERVICE_ROLE_KEY!), baseUrl: env.APP_BASE_URL!,
    });
    console.info(`조직 생성: ${r.orgId}\n관리자: ${opts['admin-email']}\n비밀번호 설정 링크(1회용, 본인에게만 전달):\n${r.link}`);
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
