import type { ParamsStatus, VerificationStatus } from '@xhs/domain';

export type EndpointId =
  | 'RF01' | 'RF02' | 'RF03' | 'RF04' | 'RF05' | 'RF06' | 'RF07'
  | 'RF08' | 'RF09' | 'RF10' | 'RF11' | 'RF12' | 'RF13' | 'RF14';

export type EndpointCapability = {
  id: EndpointId | 'AP01';
  method: 'GET' | 'POST';
  path: string;
  purpose: string;
  paramsStatus: ParamsStatus;
  verificationStatus: VerificationStatus;
  /** Unit price is never assumed; unknown blocks live calls (spec 6.3). */
  priceStatus: 'unknown' | 'verified';
  phase: 'P0' | 'P1';
  /** Result of a submit is unknown on timeout → never auto-resend. */
  nonIdempotentSubmit: boolean;
  docUrl: string;
};

const DOC = 'https://redfox.hk/apis/xiaohongshu/';

/**
 * Spec 5.2. Nothing has been called live, so every endpoint is `documented`.
 * RF08/RF10 have unverified parameter names and stay blocked even in live mode.
 * RFX1 (video download) is intentionally absent: excluded by spec 1.4.
 */
export const REDFOX_CAPABILITIES: Readonly<Record<EndpointId, EndpointCapability>> = Object.freeze({
  RF01: cap('RF01', 'POST', '/story/api/xhs/search/search', 'note search + related terms', 'documented', 'P0', false, '3X8FGEEM'),
  RF02: cap('RF02', 'POST', '/story/api/xhsUser/searchArticle', 'keyword note search', 'documented', 'P0', false, '384C6W6B'),
  RF03: cap('RF03', 'GET', '/story/api/cozeSkill/getXhsCozeSkillDataOne', 'daily rank', 'documented', 'P0', false, 'AEA6YE0J'),
  RF04: cap('RF04', 'GET', '/story/api/cozeSkill/getXhsCozeSkillDataSeven', '7-day rank', 'documented', 'P0', false, 'LBYLC5AK'),
  RF05: cap('RF05', 'POST', '/story/api/cozeSkill/getLowPowderExplosiveArticle', 'low-follower hits', 'documented', 'P0', false, 'P3W2W18P'),
  RF06: cap('RF06', 'POST', '/story/api/xhsUser/searchUser', 'account search', 'documented', 'P0', false, '439NFLBD'),
  RF07: cap('RF07', 'POST', '/story/api/xhsUser/queryAccountDetail', 'account detail', 'documented', 'P0', false, '4IVIDHEN'),
  RF08: cap('RF08', 'POST', '/story/api/xhsUser/queryWorkList', 'account notes', 'parameter_unverified', 'P0', false, 'XN3ULENA'),
  RF09: cap('RF09', 'POST', '/story/api/xhsUser/queryWorkDetail', 'note detail', 'documented', 'P0', false, 'KR1LPTBF'),
  RF10: cap('RF10', 'POST', '/story/api/xhsData/query', 'growth ranking', 'parameter_unverified', 'P0', false, '20060016'),
  RF11: cap('RF11', 'POST', '/story/api/xhs/commentSubmit', 'comment collection submit', 'documented', 'P1', true, '5AM3X4HZ'),
  RF12: cap('RF12', 'POST', '/story/api/xhs/commentResult', 'comment collection result', 'documented', 'P1', false, 'LO93CE5K'),
  RF13: cap('RF13', 'POST', '/story/api/parseWork/audioTextExtract/submit/xhs', 'audio transcript submit (F15)', 'documented', 'P1', true, null),
  RF14: cap('RF14', 'POST', '/story/api/parseWork/audioTextExtract/result/xhs', 'audio transcript result (F15)', 'documented', 'P1', false, null),
});

function cap(
  id: EndpointId, method: 'GET' | 'POST', path: string, purpose: string, paramsStatus: ParamsStatus,
  phase: 'P0' | 'P1', nonIdempotentSubmit: boolean, docId: string | null,
): EndpointCapability {
  return {
    id, method, path, purpose, paramsStatus, phase, nonIdempotentSubmit,
    verificationStatus: 'documented',
    priceStatus: 'unknown',
    docUrl: docId ? DOC + docId : 'user-provided doc (2026-10-05)',
  };
}

export const REDFOX_BASE_URL = 'https://redfox.hk';
export const PROVIDER_HOSTS = ['redfox.hk', 'api.openai.com'] as const;
