import type { DataMode } from './enums.ts';

export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_REVISION: 409,
  IDEMPOTENCY_MISMATCH: 409,
  VALIDATION_FAILED: 422,
  BUDGET_EXCEEDED: 429,
  RATE_LIMITED: 429,
  FEATURE_DISABLED: 503,
  PROVIDER_UNAVAILABLE: 503,
  LIVE_BLOCKED: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  override name = 'AppError';
  constructor(
    readonly code: ErrorCode,
    readonly messageKo: string,
    readonly retryable = false,
  ) {
    super(code);
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export type SuccessEnvelope<T> = {
  data: T;
  meta: { requestId: string; mode: DataMode; asOf: string; warnings: string[]; nextCursor: string | null };
};
export type ErrorEnvelope = {
  error: { code: ErrorCode; messageKo: string; retryable: boolean };
  requestId: string;
};
