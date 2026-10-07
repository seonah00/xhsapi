import type { AppEnv } from '@xhs/domain';
import type { EndpointCapability } from './capabilities.ts';

export type PermissionPurpose = 'fetch' | 'metadata_display' | 'excerpt_display' | 'media_display' | 'ai_processing' | 'cache';

export type ProviderPermission = {
  id: string;
  status: 'pending' | 'approved' | 'revoked' | 'expired';
  expiresAt: Date | null;
  allowedEndpoints: readonly string[];
  allows: Readonly<Record<PermissionPurpose, boolean>>;
};

export type LiveGateContext = {
  env: AppEnv;
  endpoint: EndpointCapability;
  /** Org-level switch from organizations.settings.provider_switches; cannot override a false env flag. */
  orgLiveEnabled: boolean;
  /** Historical metadata only; no longer a live prerequisite (ADR 0015). */
  permission?: ProviderPermission | null;
  purposes: readonly PermissionPurpose[];
  consentRecorded: boolean;
  /** Set only after the DB transaction reserved budget against a verified price. */
  budgetReserved: boolean;
  /** approvedQuoteId was consumed for this request, or it falls in an admin-approved schedule. */
  userApproved: boolean;
  now?: Date;
};

export type GateReason =
  | 'mode_not_live' | 'live_calls_disabled' | 'feature_disabled' | 'org_switch_off'
  | 'parameter_unverified' | 'not_implemented' | 'price_unknown'
  | 'permission_missing' | 'permission_inactive' | 'permission_expired' | 'endpoint_not_permitted' | 'purpose_not_permitted'
  | 'consent_missing' | 'budget_not_reserved' | 'not_user_approved';

export type GateResult = { allowed: true } | { allowed: false; reasons: GateReason[] };

const FEATURE_FLAG: Partial<Record<string, keyof AppEnv>> = {
  AP01: 'APIFY_ENABLED',
  RF11: 'COMMENTS_ENABLED',
  RF12: 'COMMENTS_ENABLED',
  RF13: 'TRANSCRIPT_ENABLED',
  RF14: 'TRANSCRIPT_ENABLED',
};

/** Spec 6.3: every condition must hold. A configured API key is never a condition. */
export function evaluateLiveGate(ctx: LiveGateContext): GateResult {
  const reasons: GateReason[] = [];
  const { env, endpoint } = ctx;

  if (env.APP_DATA_MODE !== 'live') reasons.push('mode_not_live');
  if (!env.LIVE_PROVIDER_CALLS_ENABLED) reasons.push('live_calls_disabled');
  const feature = FEATURE_FLAG[endpoint.id];
  if (feature && env[feature] !== true) reasons.push('feature_disabled');
  if (!ctx.orgLiveEnabled) reasons.push('org_switch_off');

  if (endpoint.paramsStatus === 'parameter_unverified') reasons.push('parameter_unverified');
  if (endpoint.paramsStatus === 'not_implemented') reasons.push('not_implemented');
  if (endpoint.priceStatus !== 'verified') reasons.push('price_unknown');

  if (!ctx.consentRecorded) reasons.push('consent_missing');
  if (!ctx.budgetReserved) reasons.push('budget_not_reserved');
  if (!ctx.userApproved) reasons.push('not_user_approved');

  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}

export class LiveCallBlockedError extends Error {
  override name = 'LiveCallBlockedError';
  constructor(readonly reasons: GateReason[]) {
    super(`live call blocked: ${reasons.join(',')}`);
  }
}
