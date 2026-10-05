import { loadEnv, publicCapabilities } from '@xhs/domain';
import { createXhsProvider } from '@xhs/providers';

/**
 * Worker entry (M0 skeleton). Validates the env fail-closed and builds the
 * provider for the configured mode. Job handlers (outbox dispatch, claim,
 * transcript/provider/AI jobs) land in M1–M3; live mode stays blocked by the
 * provider gate until permission, price and budget are recorded.
 */
export function bootstrap(source: Record<string, string | undefined> = process.env) {
  const env = loadEnv(source);
  const provider = env.APP_DATA_MODE === 'mock' ? createXhsProvider(env) : null;
  return { env, provider, capabilities: publicCapabilities(env) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { env, capabilities } = bootstrap();
  if (!env.WORKER_ENABLED) {
    console.info('worker disabled (WORKER_ENABLED=false)');
    process.exit(0);
  }
  console.info('worker ready', capabilities);
}
