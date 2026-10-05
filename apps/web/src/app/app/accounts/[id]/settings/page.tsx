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
      <PageHeader title={`${account.display_name} 설정`} description={`현재 프로필 버전 ${account.profile_version}. 저장하면 새 버전이 만들어지고, 이전 기획은 당시 버전을 유지합니다.`} />
      <ErrorNotice message={error} />
      {saved && <div className="mb-4"><Notice tone="ok">저장했습니다. 프로필 버전 {saved}</Notice></div>}
      <ProfileForm action={save} defaults={account.profile} submitLabel="새 버전으로 저장" hidden={{ accountId: account.id, revision: String(account.revision) }} />
    </div>
  );
}
