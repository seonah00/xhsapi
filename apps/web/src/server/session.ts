import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { sessionSecret } from './env';

const COOKIE = 'xhs_session';
const MAX_AGE_S = 60 * 60 * 12;

export type Session = { uid: string; orgId: string | null; exp: number };

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function encodeSession(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (typeof s.uid !== 'string' || typeof s.exp !== 'number' || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function writeSession(uid: string, orgId: string | null): Promise<void> {
  (await cookies()).set(COOKIE, encodeSession({ uid, orgId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
