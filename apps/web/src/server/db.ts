import 'server-only';
import pg from 'pg';
import { pgConfig } from '@xhs/core';

const globalForPg = globalThis as unknown as { xhsPool?: pg.Pool };

function pool(): pg.Pool {
  if (!globalForPg.xhsPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (run `pnpm db:local`)');
    globalForPg.xhsPool = new pg.Pool({ ...pgConfig(), max: 10 });
  }
  return globalForPg.xhsPool;
}

export type Db = pg.PoolClient;

/**
 * Runs fn in a transaction as the given user with RLS enforced
 * (role `authenticated`, auth.uid() = uid). All user-facing reads/writes use this.
 */
export async function withUser<T>(uid: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Server-side privileged transaction (bypasses RLS). Only for writes the spec
 * assigns to the server (ingestion, rule check runs, job state). Callers must
 * do their own ownership checks first.
 */
export async function withService<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Maps `raise exception 'CODE...'` from SQL functions to an app code. */
export function dbErrorCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : '';
  const m = /^([A-Z_]+)/.exec(msg);
  return m?.[1] ?? null;
}
