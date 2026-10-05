/** Runs once per server start. In mock mode, all non-loopback, non-database TCP connections are refused (spec 12.2). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || (process.env.APP_DATA_MODE ?? 'mock') !== 'mock') return;
  const { hostsFromUrl, installMockNetworkGuard } = await import('@xhs/security/network-guard');
  installMockNetworkGuard({
    allowHosts: hostsFromUrl(process.env.DATABASE_URL),
    onBlock: (c) => console.error(`[network-guard] blocked outbound connection to ${c.host}:${c.port ?? '?'} (mock mode)`),
  });
  console.info('mock mode: outbound network guard active (web)');
}
