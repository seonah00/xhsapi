import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readSession } from '@/server/session';
import { currentUserEmail, myMemberships } from '@/server/ctx';
import { env } from '@/server/env';
import { MockBanner } from '@/components/ui';
import { logout } from '../login/actions';

const NAV = [
  ['/app', '홈'],
  ['/app/discover', '탐색'],
  ['/app/references', '레퍼런스'],
  ['/app/keywords', '해시태그'],
  ['/app/expressions', '표현 사전'],
  ['/app/accounts', '내 계정'],
] as const;
const ROLE: Record<string, string> = { student: '학생', reviewer: '강사', org_admin: '관리자' };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await readSession();
  if (!s) redirect('/login');
  const [orgs, email] = await Promise.all([myMemberships(s.uid), currentUserEmail(s.uid)]);
  const org = orgs.find((o) => o.org_id === s.orgId);
  return (
    <div className="min-h-dvh">
      <MockBanner mode={env().APP_DATA_MODE} />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/app" className="shrink-0 whitespace-nowrap font-bold tracking-tight">XHS 스튜디오</Link>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            {org && <Link href="/app/select-organization" className="min-w-0 truncate hover:text-ink" title={org.name}>{org.name} · {ROLE[org.role] ?? org.role}</Link>}
            <span className="hidden truncate sm:inline">{email}</span>
            <form action={logout} className="shrink-0"><button className="whitespace-nowrap rounded-lg px-2 py-1 hover:bg-bg hover:text-ink">로그아웃</button></form>
          </div>
        </div>
        {org && (
          <nav aria-label="주 메뉴" className="mx-auto max-w-6xl overflow-x-auto px-2">
            <ul className="flex gap-1 whitespace-nowrap pb-2">
              {NAV.map(([href, label]) => (
                <li key={href}><Link href={href} className="block rounded-lg px-3 py-1.5 text-sm hover:bg-bg">{label}</Link></li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
