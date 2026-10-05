import { redirect } from 'next/navigation';
import { readSession, writeSession } from '@/server/session';
import { withUser } from '@/server/db';
import { btn, Card, ErrorNotice } from '@/components/ui';

export const metadata = { title: '초대 수락' };

async function accept(formData: FormData) {
  'use server';
  const s = await readSession();
  const token = String(formData.get('token') ?? '');
  if (!s) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  try {
    const orgId = await withUser(s.uid, async (db) => (await db.query<{ org: string }>(`select app.redeem_invitation($1) as org`, [token])).rows[0]!.org);
    await writeSession(s.uid, orgId);
  } catch {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent('초대 링크가 만료되었거나 이미 사용되었습니다.')}`);
  }
  redirect('/app');
}

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const s = await readSession();
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">초대 수락</h1>
      <div className="mt-4">
        <ErrorNotice message={error} />
        <Card>
          <p className="text-sm">초대 링크는 한 번만 사용할 수 있고 7일 후 만료됩니다.</p>
          <form action={accept} className="mt-4">
            <input type="hidden" name="token" value={token} />
            <button className={btn.primary}>{s ? '조직에 참여하기' : '로그인 후 참여하기'}</button>
          </form>
        </Card>
      </div>
    </main>
  );
}
