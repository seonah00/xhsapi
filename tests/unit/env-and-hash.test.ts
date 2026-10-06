import { describe, expect, it } from 'vitest';
import { canTransitionJob, canTransitionSubmission, canonicalJson, checkInputHash, EnvConfigError, loadEnv, publicCapabilities } from '@xhs/domain';

describe('loadEnv', () => {
  it('defaults to mock with everything off', () => {
    const env = loadEnv({});
    expect(env.APP_DATA_MODE).toBe('mock');
    expect(publicCapabilities(env)).toMatchObject({ liveProviderCalls: false, liveLlmCalls: false, transcript: false });
  });
  it('does not switch to live because a key is present', () => {
    const env = loadEnv({ REDFOX_API_KEY: 'ak_test123456', OPENAI_API_KEY: 'sk-test' });
    expect(env.APP_DATA_MODE).toBe('mock');
  });
  it('fails closed when live flags are on in mock mode', () => {
    expect(() => loadEnv({ LIVE_PROVIDER_CALLS_ENABLED: 'true' })).toThrow(EnvConfigError);
    expect(() => loadEnv({ TRANSCRIPT_ENABLED: 'true' })).toThrow(EnvConfigError);
  });
  it('rejects public signup and outbound email in P0', () => {
    expect(() => loadEnv({ PUBLIC_SIGNUP_ENABLED: 'true' })).toThrow(EnvConfigError);
    expect(() => loadEnv({ OUTBOUND_EMAIL_ENABLED: 'true' })).toThrow(EnvConfigError);
  });
  it('never exposes secrets through capabilities', () => {
    const caps = JSON.stringify(publicCapabilities(loadEnv({ REDFOX_API_KEY: 'ak_secretvalue' })));
    expect(caps).not.toContain('ak_secretvalue');
  });
});

describe('hashing', () => {
  it('is independent of key order but sensitive to text', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const h1 = checkInputHash({ title: '标题', body: '正文' }, { facts: ['x'] }, 'no');
    const h2 = checkInputHash({ body: '正文', title: '标题' }, { facts: ['x'] }, 'no');
    const h3 = checkInputHash({ title: '标题', body: '正文 ' }, { facts: ['x'] }, 'no');
    const h4 = checkInputHash({ title: '标题', body: '正文' }, { facts: ['x'] }, 'yes');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(h4);
  });
});

describe('state machines', () => {
  it('allows withdraw from any active submission state but nothing after withdraw', () => {
    for (const s of ['submitted', 'in_review', 'changes_requested', 'feedback_complete'] as const) {
      expect(canTransitionSubmission(s, 'withdrawn')).toBe(true);
    }
    expect(canTransitionSubmission('withdrawn', 'in_review')).toBe(false);
    expect(canTransitionSubmission('submitted', 'feedback_complete')).toBe(false);
  });
  it('never auto-resolves unknown_outcome to queued', () => {
    expect(canTransitionJob('unknown_outcome', 'queued')).toBe(false);
    expect(canTransitionJob('succeeded', 'running')).toBe(false);
  });
});

describe('auth/storage environment rules', () => {
  it('live needs Supabase login; Supabase settings must be complete and https', async () => {
    const { loadEnv } = await import('@xhs/domain');
    expect(() => loadEnv({ APP_DATA_MODE: 'live' })).toThrow(/AUTH_PROVIDER=supabase/);
    expect(() => loadEnv({ AUTH_PROVIDER: 'supabase' })).toThrow(/missing/);
    const ok = { AUTH_PROVIDER: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', APP_BASE_URL: 'https://studio.example.com' };
    expect(loadEnv(ok).AUTH_PROVIDER).toBe('supabase');
    expect(() => loadEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co' })).toThrow(/https/);
    expect(() => loadEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: 'https://user:pw@abc.supabase.co' })).toThrow(/https/);
    expect(loadEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54331', APP_BASE_URL: 'http://localhost:3100' }).APP_BASE_URL).toBe('http://localhost:3100');
    expect(() => loadEnv({ STORAGE_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('database TLS settings', () => {
  it('verifies the server with DATABASE_CA_CERT and drops URL TLS params that would override it', async () => {
    const { pgConfig } = await import('@xhs/core');
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    expect(pgConfig('postgresql://u:p@h:5432/db?sslmode=require', undefined)).toEqual({ connectionString: 'postgresql://u:p@h:5432/db?sslmode=require' });
    const c = pgConfig('postgresql://u:p@h:5432/db?sslmode=require&application_name=x', pem);
    expect(c.connectionString).toBe('postgresql://u:p@h:5432/db?application_name=x');
    expect(c.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(pgConfig('postgresql://u:p@h/db', pem.replace(/\n/g, '\\n')).ssl?.ca).toBe(pem); // pasted with literal \n
    expect(() => pgConfig('postgresql://u:p@h/db', 'not a cert')).toThrow('PEM');
  });
});

describe('Supabase key headers', () => {
  it('sends Bearer only for legacy JWT keys; new sb_ keys go in apikey only', async () => {
    const { supabaseKeyHeaders } = await import('@xhs/core');
    expect(supabaseKeyHeaders('sb_secret_abc123')).toEqual({ apikey: 'sb_secret_abc123' });
    expect(supabaseKeyHeaders('aaa.bbb.ccc')).toEqual({ apikey: 'aaa.bbb.ccc', Authorization: 'Bearer aaa.bbb.ccc' });
  });
});

describe('bundled Supabase CA', () => {
  it('is used for Supabase hosts when no variable is set; never for other hosts or explicit opt-out', async () => {
    const { pgConfig } = await import('@xhs/core');
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    const file = () => pem;
    expect(pgConfig('postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres', undefined, file).ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(pgConfig('postgresql://u:p@db.abcd.supabase.co:5432/postgres', undefined, file).ssl?.ca).toBe(pem);
    expect(pgConfig('postgresql://u:p@localhost/db', undefined, file).ssl).toBeUndefined();
    expect(pgConfig('postgresql://u:p@x.pooler.supabase.com/postgres?sslmode=no-verify', undefined, file).ssl).toBeUndefined();
    expect(pgConfig('postgresql://u:p@x.pooler.supabase.com/postgres', undefined, () => undefined).ssl).toBeUndefined();
  });
});

describe('DB connection hints', () => {
  it('explains auth, pooler user and breaker failures without echoing secrets', async () => {
    const { connectionHint } = await import('../../scripts/db-migrate.ts');
    const auth = Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' });
    const h = connectionHint(auth, 'postgresql://postgres:Secret123@aws-0-ap.pooler.supabase.com:5432/postgres')!;
    expect(h).toMatch(/비밀번호 인증 실패/);
    expect(h).toMatch(/postgres\.<프로젝트ref>/);
    expect(h).not.toContain('Secret123');
    expect(connectionHint(auth, 'postgresql://postgres.abcd:x@aws-0-ap.pooler.supabase.com:5432/postgres')).not.toMatch(/프로젝트ref> 형태여야/);
    expect(connectionHint(new Error('(ECIRCUITBREAKER) too many authentication failures'))).toMatch(/잠시 연결을 막았습니다/);
    expect(connectionHint(new Error('something else'))).toBeNull();
  });
});
