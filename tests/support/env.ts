/** Supabase settings a valid live environment needs (dummy values; tests never contact them). */
export const LIVE_AUTH_BASE = {
  AUTH_PROVIDER: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service', APP_BASE_URL: 'https://studio.example.com',
} as const;
