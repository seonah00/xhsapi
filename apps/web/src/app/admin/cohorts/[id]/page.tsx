import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCohort, listMembers, setCohortMember, updateCohort } from '@xhs/core';
import { withAdmin } from '../../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, Empty, ErrorNotice, input, Notice, PageHeader, selectAuto } from '@/components/ui';
import { ROLE_LABEL } from '../../labels';

export const metadata = { title: '기수 상세' };

async function save(f: FormData) {
  'use server';
  const id = String(f.get('id'));
  await orRedirectWithError(`/admin/cohorts/${id}`, () => withAdmin((ctx) => updateCohort(ctx, id, {
    ...(f.get('name') ? { name: String(f.get('name')) } : {}), ...(f.get('status') ? { status: String(f.get('status')) as never } : {}),
  })));
  redirect(`/admin/cohorts/${id}?done=1`);
}
async function seat(f: FormData) {
  'use server';
  const cohortId = String(f.get('cohortId'));
  const [userId, role] = String(f.get('seat') ?? '').split(':');
  await orRedirectWithError(`/admin/cohorts/${cohortId}`, () => withAdmin((ctx) => setCohortMember(ctx, { cohortId, userId: userId ?? '', role: role as never, active: f.get('active') === '1' })));
  redirect(`/admin/cohorts/${cohortId}?done=1`);
}

export default async function CohortDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const { cohort, members, everyone } = await withAdmin(async (ctx) => ({ ...(await getCohort(ctx, id)), everyone: await listMembers(ctx) }));
  const active = members.filter((m) => m.status === 'active');
  const seated = new Set(active.map((m) => `${m.userId}:${m.role}`));
  const candidates = everyone.filter((m) => m.status === 'active').flatMap((m) => {
    const role = m.role === 'student' ? 'student' : 'reviewer';
    return seated.has(`${m.userId}:${role}`) ? [] : [{ value: `${m.userId}:${role}`, label: `${m.email} (${ROLE_LABEL[role]})` }];
  });
  return (
    <>
      <PageHeader title={cohort.name} description={`학생 ${cohort.students}명 · 강사 ${cohort.reviewers}명`} actions={<Link href="/admin/cohorts" className={btn.secondary}>목록</Link>} />
      <ErrorNotice message={error} />
      {done && <div className="mb-4"><Notice tone="ok">저장했습니다.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <h2 className="font-semibold">배정된 멤버</h2>
          {active.length === 0 ? <div className="mt-3"><Empty title="아직 배정된 멤버가 없습니다" /></div> : (
            <ul className="mt-3 divide-y divide-line">
              {active.map((m) => (
                <li key={m.userId + m.role} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{m.email} <Badge tone={m.role === 'reviewer' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge></span>
                  <form action={seat}><input type="hidden" name="cohortId" value={cohort.id} /><input type="hidden" name="seat" value={`${m.userId}:${m.role}`} /><input type="hidden" name="active" value="0" /><button className={btn.small}>배정 해제</button></form>
                </li>
              ))}
            </ul>
          )}
          {cohort.status === 'active' && (
            <form action={seat} className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="cohortId" value={cohort.id} /><input type="hidden" name="active" value="1" />
              <label className="sr-only" htmlFor="seat">추가할 멤버</label>
              <select id="seat" name="seat" required className={selectAuto} defaultValue="">
                <option value="" disabled>멤버 선택</option>
                {candidates.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <button className={btn.primary} disabled={candidates.length === 0}>배정</button>
            </form>
          )}
          <p className="mt-3 text-xs text-muted">배정을 해제하면 해당 강사는 이 기수의 제출물을 즉시 볼 수 없습니다. 기록은 감사 로그에 남습니다.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">기수 설정</h2>
          <form action={save} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={cohort.id} />
            <label className="block text-sm" htmlFor="name">이름</label>
            <input id="name" name="name" defaultValue={cohort.name} maxLength={80} className={input} />
            <button className={btn.secondary}>이름 저장</button>
          </form>
          <form action={save} className="mt-4">
            <input type="hidden" name="id" value={cohort.id} /><input type="hidden" name="status" value={cohort.status === 'active' ? 'archived' : 'active'} />
            <button className={btn.ghost}>{cohort.status === 'active' ? '기수 보관(종료)' : '보관 해제'}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
