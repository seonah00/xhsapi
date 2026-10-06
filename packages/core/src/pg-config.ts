/**
 * Postgres connection settings shared by web, worker and operator scripts.
 * With DATABASE_CA_CERT (PEM text, e.g. the Supabase CA from the dashboard) the
 * server certificate is verified against it. TLS parameters in the URL are removed
 * then, because node-postgres lets URL parameters override the explicit ssl object.
 */
export type PgConfig = { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } };

const TLS_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat'];

export function pgConfig(url: string | undefined = process.env.DATABASE_URL, ca: string | undefined = process.env.DATABASE_CA_CERT): PgConfig {
  if (!url) throw new Error('DATABASE_URL is required');
  const pem = ca?.trim();
  if (!pem) return { connectionString: url };
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('DATABASE_CA_CERT must be a PEM certificate');
  const u = new URL(url);
  for (const p of TLS_PARAMS) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca: pem.replace(/\\n/g, '\n'), rejectUnauthorized: true } };
}
