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
