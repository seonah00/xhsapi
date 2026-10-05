import { redirect } from 'next/navigation';
import { changeMemberRole, listMembers, setMemberStatus } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Empty, ErrorNotice, Notice, PageHeader, selectAuto } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { ROLE_LABEL } from '../labels';

export const metadata = { title: '멤버 관리' };
const back = '/admin/members';

async function changeRole(f: FormData) {
  'use server';
  await orRedirectWithError(back, () => withAdmin((ctx) => changeMemberRole(ctx, { userId: String(f.get('userId')), role: String(f.get('role')) as never, confirm: f.get('confirm') === 'on' })));
  redirect(`${back}?done=role`);
}
async function changeStatus(f: FormData) {
  'use server';
  await orRedirectWithError(back, () => withAdmin((ctx) => setMemberStatus(ctx, { userId: String(f.get('userId')), status: String(f.get('status')) as never, confirm: f.get('confirm') === 'on' })));
  redirect(`${back}?done=status`);
}

export default async function Members({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const { error, done } = await searchParams;
  const members = await withAdmin((ctx) => listMembers(ctx));
  return (
    <>
      <PageHeader title="멤버" description="역할 변경·중지는 확인 후 적용되며 감사 기록에 남습니다. 중지된 멤버는 즉시 접근이 막힙니다." />
      <ErrorNotice message={error} />
      {done && <div className="mb-4"><Notice tone="ok">변경했습니다.</Notice></div>}
      {members.length === 0 ? <Empty title="멤버가 없습니다" /> : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.userId} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{m.email}</p>
                <Badge tone={m.role === 'org_admin' ? 'accent' : m.role === 'reviewer' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                {m.status === 'suspended' && <Badge tone="warn">중지됨</Badge>}
                {m.cohorts.map((c) => <Badge key={c.id + c.role}>{c.name} · {ROLE_LABEL[c.role]}</Badge>)}
                <span className="text-xs text-muted">가입 {fmtDate(m.joinedAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                <form action={changeRole} className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="hidden" name="userId" value={m.userId} />
                  <label className="sr-only" htmlFor={`role-${m.userId}`}>역할</label>
                  <select id={`role-${m.userId}`} name="role" defaultValue={m.role} className={selectAuto}>
                    {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" required /> 역할 변경 확인</label>
                  <button className={btn.small}>역할 변경</button>
                </form>
                <form action={changeStatus} className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="hidden" name="userId" value={m.userId} />
                  <input type="hidden" name="status" value={m.status === 'active' ? 'suspended' : 'active'} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" required /> {m.status === 'active' ? '접근 중지 확인' : '재활성화 확인'}</label>
                  <button className={btn.small}>{m.status === 'active' ? '중지' : '재활성화'}</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">강사로 바꾸거나 학생으로 바꾸면 맞지 않는 기수 배정은 자동으로 해제됩니다. 마지막 관리자는 변경할 수 없습니다.</p>
    </>
  );
}
