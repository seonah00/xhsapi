/**
 * Runs once per server start. Data providers remain worker-only. The authenticated dictionary
 * composer is the sole opt-in web-provider exception; mock mode never allows its outbound host.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const mode = process.env.APP_DATA_MODE ?? 'mock';
  const { hostsFromUrl, installMockNetworkGuard } = await import('@xhs/security/network-guard');
  const dictionaryAiAllowed = mode === 'live'
    && process.env.AUTH_PROVIDER === 'supabase'
    && process.env.LIVE_LLM_CALLS_ENABLED === 'true'
    && process.env.DICTIONARY_AI_ENABLED === 'true'
    && Boolean(process.env.GEMINI_API_KEY?.trim());
  installMockNetworkGuard({
    // Gemini uses a fixed endpoint and an additional signed-preview, consent and DB-budget gate.
    allowHosts: [
      ...hostsFromUrl(process.env.DATABASE_URL),
      ...hostsFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
      ...(dictionaryAiAllowed ? ['generativelanguage.googleapis.com'] : []),
    ],
    onBlock: (c) => console.error(`[network-guard] blocked outbound connection to ${c.host}:${c.port ?? '?'} (${mode} mode)`),
  });
  console.info(`${mode} mode: outbound network guard active (web)`);
}
