/**
 * Applies supabase/migrations/*.sql in order and records them in app.applied_migrations.
 * Never applies supabase/seed.sql (demo data) or the local test shim.
 *
 *   DATABASE_URL=... pnpm db:migrate          # apply pending migrations (each in its own transaction)
 *   pnpm db:sql                               # regenerate deploy/supabase/initial-schema.sql
 *
 * initial-schema.sql is for a brand-new Supabase project when the CLI is not used:
 * paste it once into the SQL Editor. Later updates: `pnpm db:migrate`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgConfig } from '@xhs/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'supabase', 'migrations');
export const INITIAL_SQL_PATH = join(ROOT, 'deploy', 'supabase', 'initial-schema.sql');

export function listMigrations(): { version: string; name: string; sql: string }[] {
  return readdirSync(DIR).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort().map((f) => ({
    version: f.slice(0, 14), name: f, sql: readFileSync(join(DIR, f), 'utf8'),
  }));
}

const TRACKING = `create schema if not exists app;
create table if not exists app.applied_migrations (version text primary key, name text not null, applied_at timestamptz not null default now());
revoke all on app.applied_migrations from public;`;

export async function migrate(db: pg.ClientBase, log: (s: string) => void = () => {}): Promise<string[]> {
  // Several instances may start at once: only one applies migrations, the others wait and then see nothing pending.
  await db.query(`select pg_advisory_lock(hashtext('xhs_studio_migrations'))`);
  try {
    return await migrateLocked(db, log);
  } finally {
    await db.query(`select pg_advisory_unlock(hashtext('xhs_studio_migrations'))`).catch(() => undefined);
  }
}

async function migrateLocked(db: pg.ClientBase, log: (s: string) => void): Promise<string[]> {
  await db.query(TRACKING);
  const done = new Set((await db.query<{ version: string }>(`select version from app.applied_migrations`)).rows.map((r) => r.version));
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.version)) continue;
    await db.query('begin');
    try {
      await db.query(m.sql);
      await db.query(`insert into app.applied_migrations (version, name) values ($1, $2)`, [m.version, m.name]);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback').catch(() => undefined);
      throw new Error(`${m.name} 적용 실패: ${e instanceof Error ? e.message : e}`);
    }
    applied.push(m.name);
    log(`적용: ${m.name}`);
  }
  return applied;
}

/** One script for the Supabase SQL Editor on an empty project; refuses to run twice. */
export function initialSql(): string {
  const parts = [
    '-- XHS Studio 초기 스키마 (자동 생성: pnpm db:sql). 새 Supabase 프로젝트의 SQL Editor에 한 번만 붙여 넣어 실행하세요.',
    '-- 데모 데이터(seed.sql)는 포함하지 않습니다. 이후 업데이트는 pnpm db:migrate 로 적용합니다.',
    `do $$ declare already boolean := false; begin
  if to_regclass('app.applied_migrations') is not null then
    execute 'select exists (select 1 from app.applied_migrations)' into already;
  end if;
  if already then raise exception '이미 스키마가 적용된 DB입니다. 업데이트는 pnpm db:migrate 를 사용하세요.'; end if;
end $$;`,
    TRACKING,
  ];
  for (const m of listMigrations()) {
    parts.push(`-- ==== ${m.name} ====`, m.sql.trim(), `insert into app.applied_migrations (version, name) values ('${m.version}', '${m.name}');`);
  }
  return parts.join('\n\n') + '\n';
}

async function main() {
  if (process.argv.includes('--write-sql')) {
    writeFileSync(INITIAL_SQL_PATH, initialSql());
    console.info(`작성: ${INITIAL_SQL_PATH}`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new pg.Client(pgConfig());
  await db.connect();
  try {
    const applied = await migrate(db, console.info);
    console.info(applied.length ? `완료: ${applied.length}개 적용` : '적용할 마이그레이션이 없습니다(최신).');
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
