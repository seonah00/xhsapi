import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError, invitationPreview, passwordProblem } from '@xhs/core';
import { z } from 'zod';
import { readSession, writeSession } from '@/server/session';
import { withService, withUser } from '@/server/db';
import { supabaseAuthEnabled } from '@/server/env';
import { supabaseAuth, tooManyAttempts } from '@/server/supabase';
import { btn, Card, ErrorNotice, input, label } from '@/components/ui';

export const metadata = { title: '초대 수락' };
const ROLE: Record<string, string> = { student: '학생', reviewer: '강사', org_admin: '관리자' };

const back = (token: string, msg: string) => redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(msg)}`);

async function redeemAs(uid: string, token: string) {
  try {
    const orgId = await withUser(uid, async (db) => (await db.query<{ org: string }>(`select app.redeem_invitation($1) as org`, [token])).rows[0]!.org);
    await writeSession(uid, orgId);
  } catch {
    back(token, '초대 링크가 만료되었거나 이미 사용되었습니다.');
  }
  redirect('/app');
}

async function accept(formData: FormData) {
  'use server';
  const s = await readSession();
  const token = String(formData.get('token') ?? '');
  if (!s) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  await redeemAs(s.uid, token);
}

/** Invite-only sign-up (Supabase Auth): the invitation is checked before any account is created. */
async function createAccount(formData: FormData) {
  'use server';
  if (!supabaseAuthEnabled()) redirect('/login');
  const token = String(formData.get('token') ?? '');
  if (tooManyAttempts(`invite:${token}`, 10)) back(token, '시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.');
  const inv = await withService((db) => invitationPreview(db, token));
  if (!inv?.valid) back(token, '초대 링크가 만료되었거나 이미 사용되었습니다.');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!z.string().email().max(200).safeParse(email).success) back(token, '이메일 형식을 확인하세요.');
  if (inv!.email && inv!.email.toLowerCase() !== email) back(token, '이 초대는 다른 이메일 주소로 발급되었습니다.');
  if (password !== String(formData.get('password2') ?? '')) back(token, '비밀번호 확인이 일치하지 않습니다.');
  const problem = passwordProblem(password, email);
  if (problem) back(token, problem);
  let userId = '';
  try {
    userId = (await supabaseAuth().createUser(email, password)).userId;
  } catch (e) {
    if (e instanceof AuthError && e.kind === 'email_taken') back(token, '이미 가입된 이메일입니다. 로그인한 뒤 이 초대 링크를 다시 여세요.');
    if (e instanceof AuthError && e.kind === 'weak_password') back(token, '비밀번호가 보안 기준에 맞지 않습니다. 더 길고 복잡하게 정하세요.');
    back(token, '계정을 만들 수 없습니다. 잠시 뒤 다시 시도하세요.');
  }
  await redeemAs(userId, token);
}

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const s = await readSession();
  const supa = supabaseAuthEnabled();
  const inv = supa ? await withService((db) => invitationPreview(db, token)) : null;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">초대 수락</h1>
      <div className="mt-4 space-y-4">
        <ErrorNotice message={error} />
        {supa && !inv?.valid ? (
          <Card><p className="text-sm">초대 링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.</p></Card>
        ) : (
          <>
            {inv && <Card><p className="text-sm"><strong>{inv.orgName}</strong>에 <strong>{ROLE[inv.role] ?? inv.role}</strong>(으)로 초대되었습니다.</p></Card>}
            {s || !supa ? (
              <Card>
                <p className="text-sm">초대 링크는 한 번만 사용할 수 있고 7일 후 만료됩니다.</p>
                <form action={accept} className="mt-4">
                  <input type="hidden" name="token" value={token} />
                  <button className={btn.primary}>{s ? '조직에 참여하기' : '로그인 후 참여하기'}</button>
                </form>
              </Card>
            ) : (
              <Card>
                <h2 className="font-semibold">계정 만들기</h2>
                <form action={createAccount} className="mt-3 space-y-3">
                  <input type="hidden" name="token" value={token} />
                  <div><label htmlFor="email" className={label}>이메일</label>
                    <input id="email" name="email" type="email" required maxLength={200} autoComplete="username" defaultValue={inv?.email ?? ''} readOnly={!!inv?.email} className={input} /></div>
                  <div><label htmlFor="password" className={label}>비밀번호 (10자 이상)</label>
                    <input id="password" name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={input} /></div>
                  <div><label htmlFor="password2" className={label}>비밀번호 확인</label>
                    <input id="password2" name="password2" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={input} /></div>
                  <button className={`${btn.primary} w-full`}>계정 만들고 참여하기</button>
                </form>
                <p className="mt-3 text-xs text-muted">이미 계정이 있나요? <Link className="underline" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>로그인 후 참여하기</Link></p>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}
