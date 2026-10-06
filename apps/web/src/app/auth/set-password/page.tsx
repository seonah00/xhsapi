import { redirect } from 'next/navigation';
import { AuthError, passwordProblem } from '@xhs/core';
import { supabaseAuthEnabled } from '@/server/env';
import { supabaseAuth, tooManyAttempts } from '@/server/supabase';
import { btn, Card, ErrorNotice, input, label } from '@/components/ui';

export const metadata = { title: '비밀번호 설정' };

const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;

/** One-time link issued by an admin or the operator; the token is consumed only on submit (not on page view). */
async function setPassword(formData: FormData) {
  'use server';
  const token = String(formData.get('token') ?? '');
  const again = (msg: string) => redirect(`/auth/set-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`);
  if (!supabaseAuthEnabled() || !TOKEN.test(token)) redirect('/login');
  if (tooManyAttempts(`setpw:${token}`, 5)) again('시도가 너무 많습니다. 새 링크를 요청하세요.');
  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('password2') ?? '')) again('비밀번호 확인이 일치하지 않습니다.');
  const problem = passwordProblem(password);
  if (problem) again(problem);
  try {
    await supabaseAuth().setPasswordWithToken(token, password);
  } catch (e) {
    if (e instanceof AuthError && e.kind === 'invalid_token') redirect(`/login?error=${encodeURIComponent('링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.')}`);
    if (e instanceof AuthError && e.kind === 'weak_password') again('비밀번호가 보안 기준에 맞지 않습니다.');
    again('지금은 설정할 수 없습니다. 잠시 뒤 다시 시도하세요.');
  }
  redirect('/login?done=password');
}

export default async function SetPassword({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!supabaseAuthEnabled() || !token || !TOKEN.test(token)) redirect('/login');
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">비밀번호 설정</h1>
      <div className="mt-4">
        <ErrorNotice message={error} />
        <Card>
          <form action={setPassword} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <div><label htmlFor="password" className={label}>새 비밀번호 (10자 이상)</label>
              <input id="password" name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={input} /></div>
            <div><label htmlFor="password2" className={label}>새 비밀번호 확인</label>
              <input id="password2" name="password2" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={input} /></div>
            <button className={`${btn.primary} w-full`}>설정하기</button>
          </form>
          <p className="mt-3 text-xs text-muted">이 링크는 한 번만 쓸 수 있습니다.</p>
        </Card>
      </div>
    </main>
  );
}
