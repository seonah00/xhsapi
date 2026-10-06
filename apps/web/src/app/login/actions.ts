'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuthError } from '@xhs/core';
import { demoLoginEnabled, supabaseAuthEnabled } from '@/server/env';
import { supabaseAuth, tooManyAttempts } from '@/server/supabase';
import { safeLocalPath } from '@/server/actions-util';
import { myMemberships } from '@/server/ctx';
import { clearSession, writeSession } from '@/server/session';
import { withService } from '@/server/db';

/** Demo login: mock mode only, seeded demo users only (`.invalid` emails). Real auth uses Supabase sessions. */
export async function demoLogin(formData: FormData) {
  if (!demoLoginEnabled()) redirect('/login?error=' + encodeURIComponent('데모 로그인이 비활성화되어 있습니다.'));
  const uid = z.string().uuid().parse(formData.get('uid'));
  const ok = await withService(async (db) => (await db.query(`select 1 from auth.users where id = $1 and email like '%.invalid'`, [uid])).rowCount === 1);
  if (!ok) redirect('/login?error=' + encodeURIComponent('데모 계정이 아닙니다.'));
  const orgs = await myMemberships(uid);
  await writeSession(uid, orgs.length === 1 ? orgs[0]!.org_id : null);
  const next = String(formData.get('next') ?? '');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : orgs.length === 1 ? '/app' : '/app/select-organization');
}

const fail = (msg: string, next: string) => redirect(`/login?error=${encodeURIComponent(msg)}${next ? `&next=${encodeURIComponent(next)}` : ''}`);

/** Email + password via Supabase Auth; then our own signed session cookie (Supabase tokens are not kept). */
export async function passwordLogin(formData: FormData) {
  if (!supabaseAuthEnabled()) redirect('/login');
  const next = safeLocalPath(formData.get('next'), '/') === '/' ? '' : safeLocalPath(formData.get('next'), '/');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!z.string().email().max(200).safeParse(email).success || !password) return fail('이메일과 비밀번호를 입력하세요.', next);
  if (tooManyAttempts(`login:${email}`)) return fail('로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요.', next);
  let user: { userId: string } | null;
  try {
    user = await supabaseAuth().signInWithPassword(email, password);
  } catch (e) {
    if (e instanceof AuthError && e.kind === 'rate_limited') return fail('로그인 시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.', next);
    return fail('로그인 서비스에 연결할 수 없습니다. 잠시 뒤 다시 시도하세요.', next);
  }
  if (!user) return fail('이메일 또는 비밀번호가 올바르지 않습니다.', next);
  const orgs = await myMemberships(user.userId);
  await writeSession(user.userId, orgs.length === 1 ? orgs[0]!.org_id : null);
  redirect(next || (orgs.length === 1 ? '/app' : '/app/select-organization'));
}

export async function logout() {
  await clearSession();
  redirect('/login');
}
