import { demoLoginEnabled, supabaseAuthEnabled } from '@/server/env';
import { withService } from '@/server/db';
import { btn, Card, ErrorNotice, input, label, Notice } from '@/components/ui';
import { demoLogin, passwordLogin } from './actions';

export const metadata = { title: '로그인' };

const ROLE_HINT: Record<string, string> = {
  'student-a@demo.invalid': '학생 A · 계정 설정 완료',
  'student-b@demo.invalid': '학생 B · 처음 시작',
  'reviewer@demo.invalid': '강사 · 1기 검수',
  'reviewer-other-cohort@demo.invalid': '강사 · 2기 검수',
  'admin@demo.invalid': '조직 관리자',
  'student-c@other-org.demo.invalid': '다른 조직 학생',
  'admin@other-org.demo.invalid': '다른 조직 관리자',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; done?: string }> }) {
  const { error, next, done } = await searchParams;
  const enabled = demoLoginEnabled();
  const users = enabled
    ? await withService(async (db) => (await db.query<{ id: string; email: string }>(`select id, email from auth.users where email like '%demo.invalid' order by email`)).rows)
    : [];
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">XHS 콘텐츠 스튜디오</h1>
      <p className="mt-1 text-sm text-muted">샤오홍슈 콘텐츠 탐색·기획·중국어 표현 학습 도구</p>
      <div className="mt-6">
        <ErrorNotice message={error} />
        {done === 'password' && <div className="mb-4"><Notice tone="ok">비밀번호를 설정했습니다. 새 비밀번호로 로그인하세요.</Notice></div>}
        {supabaseAuthEnabled() ? (
          <Card>
            <h2 className="font-semibold">로그인</h2>
            <form action={passwordLogin} className="mt-4 space-y-3">
              <input type="hidden" name="next" value={next ?? ''} />
              <div><label htmlFor="email" className={label}>이메일</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={200} className={input} /></div>
              <div><label htmlFor="password" className={label}>비밀번호</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} className={input} /></div>
              <button className={`${btn.primary} w-full`}>로그인</button>
            </form>
            <p className="mt-4 text-xs text-muted">계정은 초대 링크로만 만들 수 있습니다. 비밀번호를 잊었다면 조직 관리자에게 비밀번호 설정 링크를 요청하세요.</p>
          </Card>
        ) : enabled ? (
          <Card>
            <h2 className="font-semibold">데모 계정으로 로그인</h2>
            <p className="mt-1 text-xs text-muted">데모 모드 전용입니다. 모든 계정과 데이터는 가상이며 실제 학생 정보가 아닙니다.</p>
            <ul className="mt-4 space-y-2">
              {users.map((u) => (
                <li key={u.id}>
                  <form action={demoLogin}>
                    <input type="hidden" name="uid" value={u.id} />
                    <input type="hidden" name="next" value={next ?? ''} />
                    <button type="submit" className={`${btn.secondary} w-full justify-between`}>
                      <span className="truncate">{u.email}</span>
                      <span className="text-xs text-muted">{ROLE_HINT[u.email] ?? ''}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card><p className="text-sm">초대 링크로 가입한 계정으로 로그인하세요. 공개 회원가입은 지원하지 않습니다.</p></Card>
        )}
      </div>
    </main>
  );
}
