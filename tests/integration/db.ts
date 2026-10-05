import pg from 'pg';

export const ORG1 = '00000000-0000-4000-b000-000000000001';
export const ORG2 = '00000000-0000-4000-b000-000000000002';
export const COHORT1 = '00000000-0000-4000-c000-000000000001';
export const COHORT2 = '00000000-0000-4000-c000-000000000002';
export const U = {
  studentA: '00000000-0000-4000-a000-000000000001',
  studentB: '00000000-0000-4000-a000-000000000002',
  reviewer: '00000000-0000-4000-a000-000000000003',
  reviewerOther: '00000000-0000-4000-a000-000000000004',
  admin: '00000000-0000-4000-a000-000000000005',
  studentC: '00000000-0000-4000-a000-000000000006',
  admin2: '00000000-0000-4000-a000-000000000007',
} as const;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL missing: run via `pnpm test:db`');
export const pool = new pg.Pool({ connectionString: url, max: 6 });

/** Runs fn as an authenticated Supabase user (RLS applies) and commits. */
export async function asUser<T>(uid: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** Superuser connection for setup (bypasses RLS). */
export async function admin<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export async function rows<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return asUser(uid, async (c) => (await c.query(sql, params)).rows as T[]);
}

export const hex64 = (seed: string) => seed.repeat(64).slice(0, 64);
