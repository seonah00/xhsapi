import { z } from 'zod';
import type { ObjectStorage } from './storage.ts';

/**
 * Minimal server-side Supabase clients (Auth admin/password and private Storage).
 * Keys never leave the server: the browser only ever receives our own signed
 * session cookie. Requests go to the configured project URL only.
 */

/**
 * Legacy anon/service_role keys are JWTs and go in both headers. New-style keys
 * (sb_publishable_… / sb_secret_…) are not JWTs: only the apikey header is sent.
 */
export function supabaseKeyHeaders(key: string): Record<string, string> {
  const isJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
  return isJwt ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export class AuthError extends Error {
  override name = 'AuthError';
  constructor(readonly kind: 'invalid_credentials' | 'email_taken' | 'invalid_token' | 'weak_password' | 'rate_limited' | 'unavailable', message?: string) {
    super(message ?? kind);
  }
}

const UserId = z.object({ id: z.string().uuid(), email: z.string().nullable().optional() });

export const PASSWORD_MIN = 10;
/** bcrypt (used by Supabase Auth) only reads 72 bytes. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
  if (Buffer.byteLength(password, 'utf8') > 72) return '비밀번호가 너무 깁니다(72바이트 이하).';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) return '이메일 아이디가 들어간 비밀번호는 쓸 수 없습니다.';
  return null;
}

export class SupabaseAuth {
  private readonly base: string;
  constructor(url: string, private readonly anonKey: string, private readonly serviceKey: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = url.replace(/\/$/, '') + '/auth/v1';
  }

  private async call(path: string, init: { method: string; body?: unknown; admin?: boolean }): Promise<{ status: number; json: any }> {
    const key = init.admin ? this.serviceKey : this.anonKey;
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, {
        method: init.method,
        headers: { ...supabaseKeyHeaders(key), 'Content-Type': 'application/json' },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AuthError('unavailable', 'auth service unreachable');
    }
    if (res.status === 429) throw new AuthError('rate_limited');
    if (res.status >= 500) throw new AuthError('unavailable', `auth service ${res.status}`);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  /** Returns the user on success, null for wrong email/password (never says which). */
  async signInWithPassword(email: string, password: string): Promise<{ userId: string } | null> {
    const r = await this.call('/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (r.status === 400 || r.status === 401 || r.status === 422) return null;
    const user = UserId.safeParse(r.json?.user);
    if (r.status !== 200 || !user.success) throw new AuthError('unavailable', 'unexpected sign-in response');
    return { userId: user.data.id };
  }

  /** Invite-only accounts: confirmed immediately because the one-time invitation link was the proof. */
  async createUser(email: string, password?: string): Promise<{ userId: string }> {
    const r = await this.call('/admin/users', { method: 'POST', admin: true, body: { email, ...(password ? { password } : {}), email_confirm: true } });
    if (r.status >= 400) {
      const msg = `${r.json?.error_code ?? ''} ${r.json?.msg ?? r.json?.message ?? ''}`;
      if (/password/i.test(msg)) throw new AuthError('weak_password');
      if (r.status === 409 || r.status === 422 || /already|exists|registered/i.test(msg)) throw new AuthError('email_taken');
      throw new AuthError('unavailable', `create user failed (${r.status})`);
    }
    const user = UserId.safeParse(r.json?.id ? r.json : r.json?.user);
    if (!user.success) throw new AuthError('unavailable', 'unexpected create user response');
    return { userId: user.data.id };
  }

  /** One-time password-set token (no e-mail is sent; the operator/admin hands over our own link). */
  async recoveryTokenHash(email: string): Promise<string> {
    const r = await this.call('/admin/generate_link', { method: 'POST', admin: true, body: { type: 'recovery', email } });
    const hash = r.json?.properties?.hashed_token ?? r.json?.hashed_token;
    if (r.status !== 200 || typeof hash !== 'string' || hash.length < 16) throw new AuthError('unavailable', `generate link failed (${r.status})`);
    return hash;
  }

  /** Consumes the one-time token, then sets the password with admin rights. */
  async setPasswordWithToken(tokenHash: string, password: string): Promise<{ userId: string }> {
    const v = await this.call('/verify', { method: 'POST', body: { type: 'recovery', token_hash: tokenHash } });
    const user = UserId.safeParse(v.json?.user);
    if (v.status !== 200 || !user.success) throw new AuthError('invalid_token');
    const u = await this.call(`/admin/users/${user.data.id}`, { method: 'PUT', admin: true, body: { password } });
    if (u.status === 422) throw new AuthError('weak_password');
    if (u.status !== 200) throw new AuthError('unavailable', `password update failed (${u.status})`);
    return { userId: user.data.id };
  }
}

const OBJECT_KEY = /^[a-z0-9-]{8,64}\/[a-f0-9-]{36}$/;

/** Private Supabase Storage bucket (service key; objects are never public or signed for browsers). */
export class SupabaseStorage implements ObjectStorage {
  private readonly base: string;
  constructor(url: string, private readonly serviceKey: string, private readonly bucket: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = url.replace(/\/$/, '') + '/storage/v1';
  }
  private headers(extra: Record<string, string> = {}) {
    return { ...supabaseKeyHeaders(this.serviceKey), ...extra };
  }
  private path(key: string) {
    if (!OBJECT_KEY.test(key)) throw new Error('invalid storage key');
    return `${encodeURIComponent(this.bucket)}/${key}`;
  }
  async put(key: string, bytes: Uint8Array) {
    const res = await this.fetchImpl(`${this.base}/object/${this.path(key)}`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }), body: bytes as unknown as BodyInit,
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`storage put failed (${res.status})`);
  }
  async get(key: string) {
    const res = await this.fetchImpl(`${this.base}/object/authenticated/${this.path(key)}`, { headers: this.headers(), redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`storage get failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async remove(key: string) {
    const res = await this.fetchImpl(`${this.base}/object/${encodeURIComponent(this.bucket)}`, {
      method: 'DELETE', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [this.path(key).split('/').slice(1).join('/')] }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`storage remove failed (${res.status})`);
  }
}
