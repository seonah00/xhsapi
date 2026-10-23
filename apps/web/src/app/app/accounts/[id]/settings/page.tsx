import { redirect } from 'next/navigation';
import { getAccount, updateAccountProfile } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { ProfileForm, profileFromForm } from '@/components/profile-form';

export const metadata = { title: '계정 설정' };

async function save(f: FormData) {
  'use server';
  const id = String(f.get('accountId'));
  const back = `/app/accounts/${id}/settings`;
  const version = await orRedirectWithError(back, () => withPageCtx((ctx) => updateAccountProfile(ctx, id, profileFromForm(f), Number(f.get('revision')))));
  redirect(`${back}?saved=${version}`);
}

export default async function AccountSettings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const account = await withPageCtx((ctx) => getAccount(ctx, id));
  return (
    <div className="max-w-2xl">
      <PageHeader title={`${account.display_name} 설정`} description="주제·독자·말투를 수정하세요. 이전 작성물은 그대로 유지됩니다." />
      <ErrorNotice message={error} />
      {saved && <div className="mb-4"><Notice tone="ok">저장했습니다.</Notice></div>}
      <ProfileForm action={save} defaults={account.profile} submitLabel="변경사항 저장" hidden={{ accountId: account.id, revision: String(account.revision) }} />
    </div>
  );
}
