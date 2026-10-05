import 'server-only';
import { loadEnv, type AppEnv } from '@xhs/domain';

let cached: AppEnv | null = null;

export function env(): AppEnv {
  cached ??= loadEnv(process.env);
  return cached;
}

/** Demo login exists only in mock mode (spec F01: no public signup). */
export function demoLoginEnabled(): boolean {
  return env().APP_DATA_MODE === 'mock' && process.env.DEMO_LOGIN_ENABLED !== 'false';
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (env().APP_DATA_MODE === 'mock') return 'mock-mode-local-session-secret-not-for-production';
  throw new Error('SESSION_SECRET (>=32 chars) is required outside mock mode');
}
