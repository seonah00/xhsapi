import { redirect } from 'next/navigation';
import { readSession, writeSession } from '@/server/session';
import { myMemberships } from '@/server/ctx';
import { btn, Card, Empty } from '@/components/ui';

export const metadata = { title: '조직 선택' };
const ROLE: Record<string, string> = { student: '학생', reviewer: '강사', org_admin: '조직 관리자' };

async function choose(formData: FormData) {
  'use server';
  const s = await readSession();
  if (!s) redirect('/login');
  const orgId = String(formData.get('orgId'));
  const orgs = await myMemberships(s.uid);
  if (!orgs.some((o) => o.org_id === orgId)) redirect('/app/select-organization');
  await writeSession(s.uid, orgId);
  redirect('/app');
}

export default async function SelectOrg() {
  const s = await readSession();
  if (!s) redirect('/login');
  const orgs = await myMemberships(s.uid);
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">조직 선택</h1>
      <div className="mt-4 space-y-2">
        {orgs.length === 0 && <Empty title="참여한 조직이 없습니다">초대 링크로 참여할 수 있습니다.</Empty>}
        {orgs.map((o) => (
          <Card key={o.org_id}>
            <form action={choose} className="flex items-center justify-between gap-3">
              <input type="hidden" name="orgId" value={o.org_id} />
              <div><p className="font-medium">{o.name}</p><p className="text-xs text-muted">{ROLE[o.role] ?? o.role}</p></div>
              <button className={btn.primary}>선택</button>
            </form>
          </Card>
        ))}
      </div>
    </main>
  );
}
