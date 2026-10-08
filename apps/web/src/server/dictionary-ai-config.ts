import 'server-only';
import type { DictionaryAiConfig } from '@xhs/core';
import { env, sessionSecret } from './env';

/** Explicit opt-in only. No public/client environment values contain credentials. */
export function getDictionaryAiConfig(): DictionaryAiConfig {
  const settings = env();
  return {
    enabled: settings.APP_DATA_MODE === 'live'
      && settings.AUTH_PROVIDER === 'supabase'
      && settings.LIVE_LLM_CALLS_ENABLED
      && settings.DICTIONARY_AI_ENABLED,
    ...(settings.GEMINI_API_KEY ? { apiKey: settings.GEMINI_API_KEY } : {}),
    sessionSecret: sessionSecret(),
    model: 'gemini-3.8-flash',
    // Conservative initial rollout. Raising these requires an explicit budget change.
    userDailyLimit: 3,
    globalMonthlyUsdLimit: 5,
  };
}
