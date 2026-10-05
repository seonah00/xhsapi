import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readSession } from '@/server/session';
import { currentUserEmail, myMemberships } from '@/server/ctx';
import { env } from '@/server/env';
import { logout } from '@/app/login/actions';
import { MockBanner } from './ui';

const ROLE: Record<string, string> = { student: '학생', reviewer: '강사', org_admin: '관리자' };

export const STUDENT_NAV = [
  ['/app', '홈'], ['/app/discover', '탐색'], ['/app/references', '레퍼런스'], ['/app/reference-accounts', '참고 계정'], ['/app/library', '자료실'], ['/app/keywords', '해시태그'], ['/app/expressions', '표현 사전'],
  ['/app/plans', '기획실'], ['/app/check', '점검'], ['/app/submissions', '제출'], ['/app/results', '성과'], ['/app/accounts', '내 계정'],
] as const;
export const STAFF_NAV = [['/review/submissions', '검토함'], ['/review/library', '자료실 검토'], ['/review/expressions', '표현 검수'], ['/review/rules', '점검 규칙'], ['/review/reports', '신고']] as const;
export const ADMIN_NAV = [
  ['/admin', '개요'], ['/admin/members', '멤버'], ['/admin/invitations', '초대'], ['/admin/cohorts', '기수'], ['/review/expressions', '표현 검수'], ['/review/rules', '점검 규칙'], ['/review/reports', '신고'], ['/admin/taxonomy', '분류 체계'], ['/admin/providers', '공급자·스위치'], ['/admin/usage', '사용량·한도'], ['/admin/jobs', '작업'], ['/admin/audit', '감사 기록'], ['/app', '← 학습 화면'],
] as const;

export async function AppShell({ children, area }: { children: React.ReactNode; area: 'app' | 'admin' }) {
  const s = await readSession();
  if (!s) redirect('/login');
  const [orgs, email] = await Promise.all([myMemberships(s.uid), currentUserEmail(s.uid)]);
  const org = orgs.find((o) => o.org_id === s.orgId);
  const isAdmin = org?.role === 'org_admin';
  const isStaff = org?.role === 'reviewer' || isAdmin;
  const nav = area === 'admin' ? ADMIN_NAV : [...STUDENT_NAV, ...(isStaff ? STAFF_NAV : []), ...(isAdmin ? [['/admin', '관리자'] as const] : [])];
  return (
    <div className="min-h-dvh">
      <MockBanner mode={env().APP_DATA_MODE} />
      <header className={`sticky top-0 z-20 border-b border-line backdrop-blur ${area === 'admin' ? 'bg-ink/95 text-bg' : 'bg-surface/95'}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href={area === 'admin' ? '/admin' : '/app'} className="shrink-0 whitespace-nowrap font-bold tracking-tight">
            XHS 스튜디오{area === 'admin' && <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] text-white">관리자</span>}
          </Link>
          <div className={`flex min-w-0 items-center gap-2 text-xs ${area === 'admin' ? 'text-bg/70' : 'text-muted'}`}>
            {org && <Link href="/app/select-organization" className="min-w-0 truncate hover:underline" title={org.name}>{org.name} · {ROLE[org.role] ?? org.role}</Link>}
            <span className="hidden truncate sm:inline">{email}</span>
            <form action={logout} className="shrink-0"><button className="whitespace-nowrap rounded-lg px-2 py-1 hover:underline">로그아웃</button></form>
          </div>
        </div>
        {org && (
          <nav aria-label={area === 'admin' ? '관리자 메뉴' : '주 메뉴'} className="mx-auto max-w-6xl overflow-x-auto px-2">
            <ul className="flex gap-1 whitespace-nowrap pb-2">
              {nav.map(([href, label]) => (
                <li key={href}><Link href={href} className={`block rounded-lg px-3 py-1.5 text-sm ${area === 'admin' ? 'hover:bg-bg/10' : 'hover:bg-bg'}`}>{label}</Link></li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
