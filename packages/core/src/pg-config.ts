/**
 * Postgres connection settings shared by web, worker and operator scripts.
 * With DATABASE_CA_CERT (PEM text, e.g. the Supabase CA from the dashboard) the
 * server certificate is verified against it. TLS parameters in the URL are removed
 * then, because node-postgres lets URL parameters override the explicit ssl object.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type PgConfig = { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } };

const TLS_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat'];

/** Committed public Supabase CA (deploy/certs/supabase-ca.crt), found from the repo root or apps/web. */
export function bundledSupabaseCa(cwd = process.cwd()): string | undefined {
  for (const p of [resolve(cwd, 'deploy/certs/supabase-ca.crt'), resolve(cwd, '../../deploy/certs/supabase-ca.crt')]) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return undefined;
}

const isSupabaseHost = (url: string) => { try { return /(^|\.)(supabase\.co|supabase\.com)$/.test(new URL(url).hostname); } catch { return false; } };

export function pgConfig(url: string | undefined = process.env.DATABASE_URL, ca: string | undefined = process.env.DATABASE_CA_CERT, bundled: () => string | undefined = bundledSupabaseCa): PgConfig {
  if (!url) throw new Error('DATABASE_URL is required');
  // Explicit variable wins; otherwise Supabase hosts use the committed public CA, unless the URL opts out (sslmode=no-verify/disable).
  const optOut = /[?&]sslmode=(no-verify|disable)\b/.test(url);
  const pem = (ca?.trim() || (!optOut && isSupabaseHost(url) ? bundled()?.trim() : undefined));
  if (!pem) return { connectionString: url };
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('DATABASE_CA_CERT must be a PEM certificate');
  const u = new URL(url);
  for (const p of TLS_PARAMS) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca: pem.replace(/\\n/g, '\n'), rejectUnauthorized: true } };
}
