// Category collection counts matching taxonomy results toward its bounded target (ADR 0017).
import pg from 'pg';
import { loadEnv, publicCapabilities } from '@xhs/domain';
import { ApifyNoteDetailProvider, createXhsProvider, MockXhsProvider, RedfoxXhsProvider } from '@xhs/providers';
import { resolve } from 'node:path';
import { hostsFromUrl, installMockNetworkGuard } from '@xhs/security/network-guard';
import { redactString } from '@xhs/security';
import { claimableJobIds, LocalPrivateStorage, pgConfig, purgeExpired, runJob, SupabaseStorage, type Runner } from '@xhs/core';

/**
 * Worker: polls `app_jobs` (the domain source of truth) and claims rows with a
 * lease. Duplicate deliveries cannot double-run (app.claim_job). pg-boss is not
 * used yet; see ADR 0002.
 */
export function bootstrap(source: Record<string, string | undefined> = process.env) {
  const env = loadEnv(source);
  const mock = { transcriptProcessingMs: 2000 };
  if (env.APP_DATA_MODE !== 'live') {
    return { env, provider: createXhsProvider(env, { mock }), liveProvider: undefined, capabilities: publicCapabilities(env) };
  }
  // Live: the key stays in this process; each job gets an adapter whose gate is built from stored
  // org switches, verified price, budget and consent (core liveGateForJob; ADR 0015).
  // Historical permission records are not execution prerequisites. Mock jobs keep the mock provider.
  // Search ingestion retains query-to-note matches for the shared discovery page (ADR 0016).
  const key = env.REDFOX_API_KEY;
  if (!key) throw new Error('live mode requires REDFOX_API_KEY (server secret)');
  return {
    env, provider: new MockXhsProvider(mock), capabilities: publicCapabilities(env),
    liveProvider: (g: Parameters<NonNullable<import('@xhs/core').JobDeps['liveProvider']>>[0]) => new RedfoxXhsProvider(key, g.gateFor, fetch, g.capabilities, undefined, g.searchEndpoint),
  };
}

export function makeRunner(pool: pg.Pool): Runner {
  return async (fn) => {
    const c = await pool.connect();
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
  };
}

async function main() {
  const { env, provider, liveProvider, capabilities } = bootstrap();
  const apifyDetailProvider = (o: import('@xhs/providers').ApifyDetailOptions) => new ApifyNoteDetailProvider(o);
  if (!env.WORKER_ENABLED) {
    console.info('worker disabled (WORKER_ENABLED=false)');
    return;
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  // Mock: only loopback and the database (spec 12.2). Live: additionally the provider host, nothing else.
  const live = env.APP_DATA_MODE === 'live';
  installMockNetworkGuard({
    allowHosts: [...hostsFromUrl(env.DATABASE_URL), ...hostsFromUrl(env.STORAGE_BACKEND === 'supabase' ? env.NEXT_PUBLIC_SUPABASE_URL : undefined), ...(live ? ['redfox.hk', ...(env.APIFY_ENABLED ? ['api.apify.com'] : [])] : [])],
    onBlock: (c) => console.error(`[network-guard] blocked outbound connection to ${c.host}:${c.port ?? '?'} (${env.APP_DATA_MODE} mode)`),
  });
  console.info(`${env.APP_DATA_MODE} mode: outbound network guard active (worker)`);
  const pool = new pg.Pool({ ...pgConfig(env.DATABASE_URL), max: 4 });
  const service = makeRunner(pool);
  const workerId = `worker-${process.pid}`;
  const intervalMs = Number(process.env.WORKER_POLL_MS ?? 1000);
  console.info('worker ready', { workerId, ...capabilities });
  const storage = env.STORAGE_BACKEND === 'supabase'
    ? new SupabaseStorage(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, env.SUPABASE_STORAGE_BUCKET)
    : new LocalPrivateStorage(process.env.ASSET_STORAGE_DIR ?? resolve(process.cwd(), '.data/assets'));
  let lastPurge = 0;
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  while (!stopping) {
    try {
      for (const id of await claimableJobIds(service)) {
        const outcome = await runJob({ service, provider, storage, env, apifyDetailProvider, pollBaseMs: live ? 30_000 : 2000, ...(liveProvider ? { liveProvider } : {}) }, id, workerId);
        if (outcome) console.info('job', id, outcome.state);
      }
      if (Date.now() - lastPurge > 3600_000) {
        lastPurge = Date.now();
        console.info('expiry purge', await service((db) => purgeExpired(db)));
      }
    } catch (e) {
      console.error('worker loop error', redactString(e instanceof Error ? e.message : String(e)));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('worker fatal', redactString(e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    process.exit(1);
  });
}
