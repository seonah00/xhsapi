import { redirect } from 'next/navigation';
import { listCohorts, listInvitations, revokeInvitation } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, Empty, ErrorNotice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { INVITE_STATE, ROLE_LABEL } from '../labels';
import { InviteForm } from './invite-form';

export const metadata = { title: '초대' };

async function revoke(f: FormData) {
  'use server';
  await orRedirectWithError('/admin/invitations', () => withAdmin((ctx) => revokeInvitation(ctx, String(f.get('id')))));
  redirect('/admin/invitations');
}

export default async function Invitations({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { invites, cohorts } = await withAdmin(async (ctx) => ({ invites: await listInvitations(ctx), cohorts: (await listCohorts(ctx)).filter((c) => c.status === 'active') }));
  return (
    <>
      <PageHeader title="초대" description="공개 회원가입은 없습니다. 한 번만 쓸 수 있는 초대 링크(최대 7일)로 참여합니다." />
      <ErrorNotice message={error} />
      <Card className="mb-6"><h2 className="mb-3 font-semibold">새 초대</h2><InviteForm cohorts={cohorts.map((c) => ({ id: c.id, name: c.name }))} /></Card>
      {invites.length === 0 ? <Empty title="초대 기록이 없습니다" /> : (
        <ul className="space-y-2">
          {invites.map((i) => {
            const [label, tone] = INVITE_STATE[i.state]!;
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone}>{label}</Badge>
                  <span>{ROLE_LABEL[i.role]}</span>
                  {i.cohortName && <Badge>{i.cohortName}</Badge>}
                  {i.email && <span className="text-muted">{i.email}</span>}
                  <span className="text-xs text-muted">생성 {fmtDate(i.createdAt, true)} · 만료 {fmtDate(i.expiresAt, true)}{i.usedAt && ` · 사용 ${fmtDate(i.usedAt, true)}`}</span>
                </div>
                {i.state === 'active' && <form action={revoke}><input type="hidden" name="id" value={i.id} /><button className={btn.small}>취소</button></form>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
