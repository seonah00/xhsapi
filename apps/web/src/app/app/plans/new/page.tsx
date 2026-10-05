import { redirect } from 'next/navigation';
import { createPlan, listAccounts, listReferences } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { btn, Card, Empty, ErrorNotice, input, label, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: '새 기획' };

async function create(f: FormData) {
  'use server';
  const id = await orRedirectWithError('/app/plans/new', () => withPageCtx((ctx) => createPlan(ctx, {
    accountId: String(f.get('accountId')), title: String(f.get('title') ?? ''), referenceIds: f.getAll('referenceIds').map(String),
    subject: String(f.get('subject') ?? '').trim() || undefined, seedText: String(f.get('seed') ?? '').trim() || undefined,
  })));
  redirect(`/app/plans/${id}`);
}

export default async function NewPlan({ searchParams }: { searchParams: Promise<{ error?: string; ref?: string; seed?: string }> }) {
  const sp = await searchParams;
  const { accounts, refs } = await withPageCtx(async (ctx) => ({ accounts: await listAccounts(ctx), refs: await listReferences(ctx) }));
  if (accounts.length === 0) return <Empty title="먼저 계정 방향을 설정하세요"><div className="mt-2"><LinkButton href="/app/accounts/new" variant="primary">계정 설정</LinkButton></div></Empty>;
  return (
    <div className="max-w-2xl">
      <PageHeader title="새 기획" description="시작 방법: 새 소재를 적거나, 저장한 레퍼런스(최대 5개)를 고르거나, 키워드·표현에서 시작하세요." />
      <ErrorNotice message={sp.error} />
      <Card>
        <form action={create} className="space-y-4">
          <div><label htmlFor="title" className={label}>기획 이름</label><input id="title" name="title" required maxLength={200} className={input} placeholder="예: 민감성 피부 아침 루틴" /></div>
          <div><label htmlFor="accountId" className={label}>계정</label>
            <select id="accountId" name="accountId" className={input}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}</select></div>
          <div><label htmlFor="subject" className={label}>다룰 대상 (선택)</label><input id="subject" name="subject" maxLength={200} className={`${input} zh`} placeholder="예: 敏感肌面霜" /></div>
          <div><label htmlFor="seed" className={label}>키워드·표현에서 시작 (선택)</label><input id="seed" name="seed" defaultValue={sp.seed} maxLength={40} className={`${input} zh`} /></div>
          <fieldset>
            <legend className={label}>참고할 레퍼런스 (최대 5개)</legend>
            {refs.length === 0 ? <p className="text-sm text-muted">저장한 레퍼런스가 없습니다.</p> : (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {refs.slice(0, 50).map((r) => (
                  <li key={r.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="referenceIds" value={r.id} defaultChecked={sp.ref === r.id} />
                    <span className="zh truncate">{r.title ?? r.note?.title ?? r.manualUrl ?? '제목 없음'}</span></label></li>
                ))}
              </ul>
            )}
          </fieldset>
          <button className={btn.primary}>기획 만들기</button>
        </form>
      </Card>
    </div>
  );
}
