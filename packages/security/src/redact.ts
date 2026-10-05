const SECRET_KEYS = /(api[_-]?key|token|secret|password|authorization|cookie|service[_-]?role)/i;
const SECRET_VALUES: RegExp[] = [
  /\bak_[A-Za-z0-9]{6,}\b/g, // RedFox key format from provider docs
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWT
  /xsec_token=[^&\s"]+/g,
];
const PHONE_CN = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const PHONE_KR = /(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactString(input: string): string {
  let out = input;
  for (const re of SECRET_VALUES) out = out.replace(re, (m) => (m.startsWith('xsec_token=') ? 'xsec_token=[REDACTED]' : '[REDACTED]'));
  return out.replace(PHONE_CN, '[PHONE]').replace(PHONE_KR, '[PHONE]').replace(EMAIL, '[EMAIL]');
}

/** Spec F12/10.2: logs keep a redacted summary only. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

/** Spec F15: mask personal data in transcript text before storage. */
export function maskPersonalInfo(text: string): { text: string; masked: boolean } {
  const out = text.replace(PHONE_CN, '[电话]').replace(PHONE_KR, '[전화]').replace(EMAIL, '[邮箱]');
  return { text: out, masked: out !== text };
}
