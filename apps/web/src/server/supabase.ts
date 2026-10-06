import 'server-only';
import { SupabaseAuth } from '@xhs/core';
import { env } from './env';

let auth: SupabaseAuth | null = null;

/** Server-only Supabase Auth client (keys never reach the browser). */
export function supabaseAuth(): SupabaseAuth {
  const e = env();
  if (e.AUTH_PROVIDER !== 'supabase') throw new Error('AUTH_PROVIDER is not supabase');
  auth ??= new SupabaseAuth(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, e.SUPABASE_SERVICE_ROLE_KEY!);
  return auth;
}

/** Public origin for one-time links: APP_BASE_URL, never the request Host header (header injection). */
export function publicOrigin(fallbackHost: string | null, proto: string | null): string {
  const base = env().APP_BASE_URL;
  if (base) return base.replace(/\/$/, '');
  return `${proto ?? 'http'}://${fallbackHost ?? 'localhost'}`;
}

/** Small in-memory attempt limiter (per process) on top of Supabase's own limits. */
const attempts = new Map<string, { n: number; until: number }>();
export function tooManyAttempts(key: string, max = 8, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) { attempts.set(key, { n: 1, until: now + windowMs }); return false; }
  a.n += 1;
  if (attempts.size > 10_000) attempts.clear();
  return a.n > max;
}
