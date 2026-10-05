/**
 * Read-path timing with a large note table (spec 10: performance). Mock data only.
 * Clones the seeded synthetic notes until the org holds ~TARGET notes, then times
 * the main read services as an authenticated user (RLS on), reporting p50/p95/max.
 * Usage: bash scripts/with-test-db.sh --keep && pnpm tsx scripts/seed-demo.ts && DATABASE_URL=... pnpm tsx scripts/perf.ts
 */
import pg from 'pg';
import { accountCandidates, discover, DiscoverQuery, homeData, listKeywords, listLibrary, type Ctx } from '@xhs/core';

const ORG = '00000000-0000-4000-b000-000000000001';
const STUDENT_A = '00000000-0000-4000-a000-000000000001';
const TARGET = Number(process.env.PERF_NOTES ?? 10_000);
const RUNS = 15;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: url, max: 4 });

async function grow() {
  const have = (await pool.query(`select count(*)::int as n from notes where org_id = $1 and data_mode = 'mock'`, [ORG])).rows[0].n as number;
  if (have >= TARGET) return have;
  const base = (await pool.query(`select count(*)::int as n from notes where org_id = $1 and data_mode = 'mock' and not is_fallback and platform_note_id not like '%~p%'`, [ORG])).rows[0].n as number;
  const copies = Math.ceil((TARGET - have) / base);
  const cols = (await pool.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'notes'
                                    and column_name not in ('id', 'platform_note_id', 'canonical_url', 'created_at', 'updated_at') order by ordinal_position`)).rows.map((r) => r.column_name as string);
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`create temp table m on commit drop as
      select n.id as old_id, gen_random_uuid() as new_id, g from notes n, generate_series(1, $2::int) g
      where n.org_id = $1 and n.data_mode = 'mock' and not n.is_fallback and n.platform_note_id not like '%~p%'`, [ORG, copies]);
    await c.query(`insert into notes (id, platform_note_id, canonical_url, ${cols.join(', ')})
      select m.new_id, n.platform_note_id || '~p' || m.g, n.canonical_url || '#p' || m.g, ${cols.map((k) => k === 'published_at' ? `n.published_at - (m.g || ' hours')::interval` : `n.${k}`).join(', ')}
      from m join notes n on n.id = m.old_id`);
    await c.query(`insert into note_taxonomy (note_id, taxonomy_id, classifier_version, confidence) select m.new_id, t.taxonomy_id, t.classifier_version, t.confidence from m join note_taxonomy t on t.note_id = m.old_id`);
    await c.query(`insert into metric_snapshots (note_id, observed_at, provider_snapshot_at, rank_date, window_json, metrics_json)
      select m.new_id, s.observed_at, s.provider_snapshot_at, s.rank_date, s.window_json, s.metrics_json from m join metric_snapshots s on s.note_id = m.old_id`);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  await pool.query('analyze');
  return (await pool.query(`select count(*)::int as n from notes where org_id = $1 and data_mode = 'mock'`, [ORG])).rows[0].n as number;
}

async function asStudent<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [STUDENT_A]);
    await c.query('set local role authenticated');
    const out = await fn({ db: c, uid: STUDENT_A, orgId: ORG, role: 'student', mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

async function time(label: string, fn: (ctx: Ctx) => Promise<unknown>) {
  await asStudent(fn); // warm-up
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) { const t = performance.now(); await asStudent(fn); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!.toFixed(1);
  console.log(`| ${label} | ${q(0.5)} | ${q(0.95)} | ${ms.at(-1)!.toFixed(1)} |`);
}

const notes = await grow();
const account = (await pool.query(`select id from creator_accounts where owner_user_id = $1 limit 1`, [STUDENT_A])).rows[0]?.id ?? null;
console.log(`notes in org: ${notes}; runs per query: ${RUNS} (ms, includes transaction + RLS setup)\n`);
console.log('| query | p50 | p95 | max |\n|---|---|---|---|');
await time('discover: latest (no query)', (ctx) => discover(ctx, DiscoverQuery.parse({})));
await time('discover: q=护肤', (ctx) => discover(ctx, DiscoverQuery.parse({ q: '护肤' })));
await time('discover: q=스킨케어 (ko→zh expansion)', (ctx) => discover(ctx, DiscoverQuery.parse({ q: '스킨케어' })));
await time('discover: topic=beauty, 7 days', (ctx) => discover(ctx, DiscoverQuery.parse({ topic: 'beauty', days: '7' })));
await time('keywords (30-day window)', (ctx) => listKeywords(ctx, {}));
await time('reference account candidates', (ctx) => accountCandidates(ctx, {}));
await time('home', (ctx) => homeData(ctx, account));
await time('library', (ctx) => listLibrary(ctx));

// Spec 10 pilot target: stored discover p95 < 2s, CRUD p95 < 1s with 10k notes and 20 concurrent users.
const USERS = 20;
const ROUNDS = 5;
const big = new pg.Pool({ connectionString: url, max: USERS });
const mix: [string, (ctx: Ctx) => Promise<unknown>][] = [
  ['discover q', (ctx) => discover(ctx, DiscoverQuery.parse({ q: '护肤' }))],
  ['discover latest', (ctx) => discover(ctx, DiscoverQuery.parse({}))],
  ['keywords', (ctx) => listKeywords(ctx, {})],
  ['home', (ctx) => homeData(ctx, account)],
];
const lat: number[] = [];
const t0 = performance.now();
await Promise.all(Array.from({ length: USERS }, async (_, u) => {
  for (let r = 0; r < ROUNDS; r++) {
    const [, fn] = mix[(u + r) % mix.length]!;
    const c = await big.connect();
    const t = performance.now();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [STUDENT_A]);
      await c.query('set local role authenticated');
      await fn({ db: c, uid: STUDENT_A, orgId: ORG, role: 'student', mode: 'mock' });
      await c.query('commit');
    } finally { c.release(); }
    lat.push(performance.now() - t);
  }
}));
lat.sort((a, b) => a - b);
const pq = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]!.toFixed(0);
console.log(`\n${USERS} concurrent users × ${ROUNDS} mixed reads (${lat.length} requests, ${(performance.now() - t0).toFixed(0)} ms wall): p50 ${pq(0.5)} ms · p95 ${pq(0.95)} ms · max ${lat.at(-1)!.toFixed(0)} ms`);
await big.end();
await pool.end();
