'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { demoLoginEnabled } from '@/server/env';
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

export async function logout() {
  await clearSession();
  redirect('/login');
}
