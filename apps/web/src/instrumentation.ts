/**
 * Runs once per server start. The web server never calls providers (the worker does), so in every
 * mode all non-loopback, non-database TCP connections are refused (spec 12.2).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const mode = process.env.APP_DATA_MODE ?? 'mock';
  const { hostsFromUrl, installMockNetworkGuard } = await import('@xhs/security/network-guard');
  installMockNetworkGuard({
    // The database, plus the Supabase project (Auth/Storage) when configured. Providers are only called by the worker.
    allowHosts: [...hostsFromUrl(process.env.DATABASE_URL), ...hostsFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)],
    onBlock: (c) => console.error(`[network-guard] blocked outbound connection to ${c.host}:${c.port ?? '?'} (${mode} mode)`),
  });
  console.info(`${mode} mode: outbound network guard active (web)`);
}
