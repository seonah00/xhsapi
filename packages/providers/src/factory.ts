import type { AppEnv } from '@xhs/domain';
import { MockXhsProvider, type MockProviderOptions } from './mock/mock-provider.ts';
import { RedfoxXhsProvider, type GateContextFor } from './redfox/redfox-provider.ts';
import type { XhsDataProvider } from './types.ts';

/**
 * Mode decides the provider; a configured key does not (spec 0.1).
 * In live mode the gate still blocks each call until permission/price/budget hold.
 */
export function createXhsProvider(env: AppEnv, deps: { gateFor?: GateContextFor; mock?: MockProviderOptions } = {}): XhsDataProvider {
  if (env.APP_DATA_MODE !== 'live') return new MockXhsProvider(deps.mock);
  if (!env.REDFOX_API_KEY) throw new Error('live mode requires REDFOX_API_KEY');
  if (!deps.gateFor) throw new Error('live mode requires a gate context resolver');
  return new RedfoxXhsProvider(env.REDFOX_API_KEY, deps.gateFor);
}
