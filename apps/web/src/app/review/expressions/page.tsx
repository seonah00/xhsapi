import { redirect } from 'next/navigation';
import { createDictionaryDraft, listDictionaryForReview, reviewDictionaryEntry } from '@xhs/core';
import { withStaff } from '@/server/staff';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, ErrorNotice, input, label, PageHeader } from '@/components/ui';
import { EXPR_TYPE_LABEL } from '@/components/labels';

export const metadata = { title: '표현 사전 검수' };
const STATUS: Record<string, [string, 'neutral' | 'info' | 'ok' | 'warn']> = { draft: ['초안', 'neutral'], reviewer_checked: ['검수됨', 'info'], published: ['공개', 'ok'], retired: ['폐기', 'warn'] };
const NEXT: Record<string, [string, string][]> = {
  draft: [['reviewer_checked', '검수 완료'], ['retired', '폐기']],
  reviewer_checked: [['published', '공개'], ['draft', '초안으로'], ['retired', '폐기']],
  published: [['retired', '공개 중단']],
  retired: [['draft', '다시 초안으로']],
};

async function create(f: FormData) {
  'use server';
  const opt = (k: string) => String(f.get(k) ?? '').trim() || undefined;
  await orRedirectWithError('/review/expressions', () => withStaff((ctx) => createDictionaryDraft(ctx, {
    expression: String(f.get('expression') ?? ''), meaning: String(f.get('meaning') ?? ''), literal: opt('literal'), nuance: opt('nuance'),
    use: opt('use'), avoid: opt('avoid'), example: opt('example'), tone: opt('tone'), expressionType: opt('type') ?? 'basic',
  })));
  redirect('/review/expressions');
}
async function decide(f: FormData) {
  'use server';
  await orRedirectWithError('/review/expressions', () => withStaff((ctx) => reviewDictionaryEntry(ctx, String(f.get('id')), String(f.get('decision')))));
  redirect('/review/expressions');
}

export default async function ExpressionReview({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const items = await withStaff((ctx) => listDictionaryForReview(ctx));
  return (
    <>
      <PageHeader title="표현 사전 검수" description="공통 사전은 초안 → 검수 → 공개 두 단계를 거칩니다. 학생에게는 공개된 항목만 보입니다. 학생 개인 표현장은 비공개라 여기 나오지 않습니다." />
      <ErrorNotice message={error} />
      <Card className="mb-6">
        <h2 className="font-semibold">새 표현 초안</h2>
        <form action={create} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="expression" className={label}>표현 (중국어)</label><input id="expression" name="expression" required maxLength={60} className={`${input} zh`} /></div>
          <div><label htmlFor="meaning" className={label}>실제 뜻</label><input id="meaning" name="meaning" required maxLength={200} className={input} /></div>
          <div><label htmlFor="literal" className={label}>직역</label><input id="literal" name="literal" maxLength={100} className={input} /></div>
          <div><label htmlFor="nuance" className={label}>뉘앙스</label><input id="nuance" name="nuance" maxLength={200} className={input} /></div>
          <div><label htmlFor="use" className={label}>쓰는 상황</label><input id="use" name="use" maxLength={200} className={input} /></div>
          <div><label htmlFor="avoid" className={label}>피할 상황</label><input id="avoid" name="avoid" maxLength={200} className={input} /></div>
          <div><label htmlFor="example" className={label}>작성 예시</label><input id="example" name="example" maxLength={200} className={`${input} zh`} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label htmlFor="tone" className={label}>말투</label><select id="tone" name="tone" className={input}><option value="">-</option><option value="friendly">친근</option><option value="informative">정보형</option><option value="humor">유머</option><option value="plain">담백</option></select></div>
            <div><label htmlFor="type" className={label}>유형</label><select id="type" name="type" className={input}>{Object.entries(EXPR_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          <div className="sm:col-span-2"><button className={btn.primary}>초안 저장</button></div>
        </form>
      </Card>
      <ul className="space-y-2">
        {items.map((e) => {
          const [l, tone] = STATUS[e.reviewStatus] ?? [e.reviewStatus, 'neutral' as const];
          return (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-3">
              <div className="min-w-0">
                <p><span className="zh text-lg font-semibold">{e.expression}</span> <Badge tone={tone}>{l}</Badge> <Badge>{EXPR_TYPE_LABEL[e.expressionType]}</Badge></p>
                <p className="text-sm text-muted">{e.explanations.meaning}{e.explanations.avoid && ` · 피할 상황: ${e.explanations.avoid}`}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(NEXT[e.reviewStatus] ?? []).map(([d, t]) => (
                  <form key={d} action={decide}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="decision" value={d} /><button className={btn.small}>{t}</button></form>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
