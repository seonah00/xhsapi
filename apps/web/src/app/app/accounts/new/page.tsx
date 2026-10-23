import { redirect } from 'next/navigation';
import { createAccount } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { ErrorNotice, PageHeader } from '@/components/ui';
import { ProfileForm, profileFromForm } from '@/components/profile-form';

export const metadata = { title: '계정 방향 설정' };

async function create(f: FormData) {
  'use server';
  const id = await orRedirectWithError('/app/accounts/new', () => withPageCtx((ctx) => createAccount(ctx, profileFromForm(f))));
  redirect(`/app?account=${id}`);
}

export default async function NewAccount({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="max-w-2xl">
      <PageHeader title="계정 방향 설정" description="다룰 주제와 독자, 말투를 정리하세요. 나중에 수정할 수 있습니다." />
      <ErrorNotice message={error} />
      <ProfileForm action={create} submitLabel="계정 만들기" />
    </div>
  );
}
