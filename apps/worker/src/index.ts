import pg from 'pg';
import { loadEnv, publicCapabilities } from '@xhs/domain';
import { createXhsProvider } from '@xhs/providers';
import { resolve } from 'node:path';
import { hostsFromUrl, installMockNetworkGuard } from '@xhs/security/network-guard';
import { redactString } from '@xhs/security';
import { claimableJobIds, LocalPrivateStorage, purgeExpired, runJob, type Runner } from '@xhs/core';

/**
 * Worker: polls `app_jobs` (the domain source of truth) and claims rows with a
 * lease. Duplicate deliveries cannot double-run (app.claim_job). pg-boss is not
 * used yet; see ADR 0002.
 */
export function bootstrap(source: Record<string, string | undefined> = process.env) {
  const env = loadEnv(source);
  if (env.APP_DATA_MODE !== 'mock') {
    // Live provider wiring (gate context from DB permission/price/budget) is not built in P0.
    throw new Error('worker: live mode is not supported in P0');
  }
  return { env, provider: createXhsProvider(env, { mock: { transcriptProcessingMs: 2000 } }), capabilities: publicCapabilities(env) };
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
  const { env, provider, capabilities } = bootstrap();
  if (!env.WORKER_ENABLED) {
    console.info('worker disabled (WORKER_ENABLED=false)');
    return;
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  // Mock mode: refuse every outbound connection except loopback and the database (spec 12.2).
  installMockNetworkGuard({
    allowHosts: hostsFromUrl(env.DATABASE_URL),
    onBlock: (c) => console.error(`[network-guard] blocked outbound connection to ${c.host}:${c.port ?? '?'} (mock mode)`),
  });
  console.info('mock mode: outbound network guard active (worker)');
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const service = makeRunner(pool);
  const workerId = `worker-${process.pid}`;
  const intervalMs = Number(process.env.WORKER_POLL_MS ?? 1000);
  console.info('worker ready', { workerId, ...capabilities });
  const storage = new LocalPrivateStorage(process.env.ASSET_STORAGE_DIR ?? resolve(process.cwd(), '.data/assets'));
  let lastPurge = 0;
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  while (!stopping) {
    try {
      for (const id of await claimableJobIds(service)) {
        const outcome = await runJob({ service, provider, storage, pollBaseMs: 2000 }, id, workerId);
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
