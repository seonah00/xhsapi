import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { INITIAL_SQL_PATH, initialSql, listMigrations, migrate } from '../../scripts/db-migrate.ts';
import { verifyDb } from '../../scripts/verify-db.ts';
import { pool } from './db.ts';

/** Fresh databases in the test cluster with only the local Supabase shim (stands in for a new Supabase project). */
const created: string[] = [];
async function freshDb(): Promise<pg.Client> {
  const name = `xhs_fresh_${Date.now()}_${created.length}`;
  await pool.query(`create database ${name}`);
  created.push(name);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  await c.query(readFileSync(new URL('../../supabase/test/00_supabase_shim.sql', import.meta.url), 'utf8'));
  return c;
}
afterAll(async () => {
  for (const n of created) await pool.query(`drop database if exists ${n} with (force)`);
  await pool.end();
});

describe('production schema setup', () => {
  it('the committed SQL Editor file is up to date with the migrations', () => {
    expect(readFileSync(INITIAL_SQL_PATH, 'utf8')).toBe(initialSql());
  });

  it('initial-schema.sql builds a working schema once and refuses a second run', async () => {
    const c = await freshDb();
    try {
      await c.query(initialSql());
      expect((await verifyDb(c)).filter((x) => !x.ok)).toEqual([]);
      const sqlChecks = (await c.query(readFileSync(new URL('../../deploy/supabase/verify.sql', import.meta.url), 'utf8'))).rows;
      expect(sqlChecks).toHaveLength(7);
      expect(sqlChecks.filter((r) => !r.ok)).toEqual([]);
      await expect(c.query(initialSql())).rejects.toThrow('이미 스키마가 적용된 DB');
      expect(await migrate(c)).toEqual([]); // the runner sees everything as applied
    } finally { await c.end(); }
  });

  it('pnpm db:migrate applies all migrations in order, then is a no-op', async () => {
    const c = await freshDb();
    try {
      expect(await migrate(c)).toEqual(listMigrations().map((m) => m.name));
      expect(await migrate(c)).toEqual([]);
      expect((await verifyDb(c)).filter((x) => !x.ok)).toEqual([]);
    } finally { await c.end(); }
  });
});
