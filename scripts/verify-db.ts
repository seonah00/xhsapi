/**
 * Post-deploy database check (read-only). Confirms what the app relies on in a real
 * Supabase project: role switching for RLS, auth.uid() from the session claim, RLS on
 * every app table, applied migrations/base data, and no demo data in production.
 *
 *   DATABASE_URL=... pnpm verify:db [--allow-demo]
 */
import pg from 'pg';
import { pgConfig } from '@xhs/core';

type Check = { name: string; ok: boolean; detail?: string };

export async function verifyDb(db: pg.ClientBase, opts: { allowDemo?: boolean } = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

  const roles = (await db.query(`select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`)).rows.map((r) => r.rolname);
  add('Supabase 역할(anon/authenticated/service_role) 존재', roles.length === 3, roles.join(','));
  add('현재 접속 역할이 authenticated로 전환 가능', (await one(`select pg_has_role(current_user, 'authenticated', 'member') as ok`)).ok);

  await db.query('begin');
  try {
    const probe = '00000000-0000-4000-8000-0000000000aa';
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [probe]);
    await db.query('set local role authenticated');
    add('auth.uid()가 세션 claim을 읽음', (await one(`select auth.uid()::text as uid`)).uid === probe);
    add('authenticated 역할로 남의 데이터가 보이지 않음(RLS)', Number((await one(`select count(*) as n from public.memberships`)).n) === 0);
  } catch (e) {
    add('authenticated 전환·auth.uid() 점검', false, e instanceof Error ? e.message : String(e));
  } finally {
    await db.query('rollback');
  }

  const noRls = (await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
  )).rows.map((r) => r.relname);
  add('public 스키마 모든 테이블에 RLS 켜짐', noRls.length === 0, noRls.join(',') || undefined);

  const fns = ['app.reserve_and_enqueue', 'app.leave_org', 'app.member_in_other_org', 'app.report_library_item'];
  for (const f of fns) add(`함수 ${f} 존재(마이그레이션 적용)`, !!(await one(`select to_regproc($1) as p`, [f])).p);
  add('기본 분류(주제 6·형식 8) 존재', Number((await one(`select count(*) as n from public.taxonomy_terms where org_id is null`)).n) >= 14);
  add('RedFox 엔드포인트 목록 존재', Number((await one(`select count(*) as n from public.provider_capabilities where provider = 'redfox'`)).n) >= 14);
  const demo = Number((await one(`select count(*) as n from auth.users where email like '%demo.invalid'`)).n);
  add('데모 계정 없음(운영 DB에 seed.sql 미적용)', opts.allowDemo || demo === 0, demo ? `${demo}개` : undefined);
  return checks;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new pg.Client(pgConfig());
  await db.connect();
  try {
    const checks = await verifyDb(db, { allowDemo: process.argv.includes('--allow-demo') });
    for (const c of checks) console.info(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    if (checks.some((c) => !c.ok)) process.exit(1);
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
