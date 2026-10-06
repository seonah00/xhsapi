import { z } from 'zod';

const flag = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

export const EnvSchema = z.object({
  APP_DATA_MODE: z.enum(['mock', 'live']).default('mock'),
  LIVE_PROVIDER_CALLS_ENABLED: flag,
  LIVE_LLM_CALLS_ENABLED: flag,
  AUTO_REFRESH_ENABLED: flag,
  COMMENTS_ENABLED: flag,
  OCR_ENABLED: flag,
  TRANSCRIPT_ENABLED: flag,
  PUBLIC_SIGNUP_ENABLED: flag,
  OUTBOUND_EMAIL_ENABLED: flag,
  WORKER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  DATABASE_URL: z.string().optional(),
  REDFOX_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  /** demo = seeded demo accounts (mock data mode only); supabase = email+password via Supabase Auth. */
  AUTH_PROVIDER: z.enum(['demo', 'supabase']).default('demo'),
  /** local = private directory (development); supabase = private Supabase Storage bucket. */
  STORAGE_BACKEND: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_STORAGE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/).default('private-assets'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** Public origin used in one-time links (invitations, password set links), e.g. https://studio.example.com */
  APP_BASE_URL: z.string().optional(),
});
export type AppEnv = z.infer<typeof EnvSchema>;

const LIVE_ONLY_FLAGS = [
  'LIVE_PROVIDER_CALLS_ENABLED', 'LIVE_LLM_CALLS_ENABLED', 'AUTO_REFRESH_ENABLED',
  'COMMENTS_ENABLED', 'OCR_ENABLED', 'TRANSCRIPT_ENABLED',
] as const;

export class EnvConfigError extends Error {
  override name = 'EnvConfigError';
}

/**
 * Spec 14: validate flag combinations at startup and fail closed.
 * A present API key never switches the app to live.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const blankToUndefined = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === '' ? undefined : v]));
  const parsed = EnvSchema.safeParse(blankToUndefined);
  if (!parsed.success) {
    throw new EnvConfigError(`Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  const env = parsed.data;
  if (env.APP_DATA_MODE === 'mock') {
    const on = LIVE_ONLY_FLAGS.filter((k) => env[k]);
    if (on.length > 0) throw new EnvConfigError(`Live-only flags enabled in mock mode: ${on.join(', ')}`);
  }
  if (env.APP_DATA_MODE === 'live' && env.AUTH_PROVIDER !== 'supabase') {
    throw new EnvConfigError('live mode requires AUTH_PROVIDER=supabase (demo login is mock-only)');
  }
  const needsSupabase = env.AUTH_PROVIDER === 'supabase' || env.STORAGE_BACKEND === 'supabase';
  if (needsSupabase) {
    const required: ('NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY' | 'APP_BASE_URL')[] = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    if (env.AUTH_PROVIDER === 'supabase') required.push('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'APP_BASE_URL');
    const missing = required.filter((k) => !env[k]);
    if (missing.length) throw new EnvConfigError(`Supabase settings missing: ${missing.join(', ')}`);
    if (!isAllowedServiceUrl(env.NEXT_PUBLIC_SUPABASE_URL!)) throw new EnvConfigError('NEXT_PUBLIC_SUPABASE_URL must be https (http only for localhost)');
    if (env.APP_BASE_URL && !isAllowedServiceUrl(env.APP_BASE_URL)) throw new EnvConfigError('APP_BASE_URL must be https (http only for localhost)');
  }
  if (env.PUBLIC_SIGNUP_ENABLED) throw new EnvConfigError('PUBLIC_SIGNUP_ENABLED is not supported in P0');
  if (env.OUTBOUND_EMAIL_ENABLED) throw new EnvConfigError('OUTBOUND_EMAIL_ENABLED requires separate approval (not in P0)');
  return env;
}

/** Safe view for /me capability flags and logs: never includes secrets. */
export function publicCapabilities(env: AppEnv) {
  return {
    mode: env.APP_DATA_MODE,
    liveProviderCalls: env.APP_DATA_MODE === 'live' && env.LIVE_PROVIDER_CALLS_ENABLED,
    liveLlmCalls: env.APP_DATA_MODE === 'live' && env.LIVE_LLM_CALLS_ENABLED,
    transcript: env.TRANSCRIPT_ENABLED,
    comments: env.COMMENTS_ENABLED,
    ocr: env.OCR_ENABLED,
    autoRefresh: env.AUTO_REFRESH_ENABLED,
  } as const;
}

/** https everywhere; plain http only for loopback (local tests). No path/query/credentials. */
export function isAllowedServiceUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  } catch {
    return false;
  }
}
