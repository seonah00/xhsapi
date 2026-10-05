import Link from 'next/link';
import { redirect } from 'next/navigation';
import { addFeedback, getSubmission, startReview } from '@xhs/core';
import { withStaff } from '@/server/staff';
import { orRedirectWithError } from '@/server/actions-util';
import { SubmissionView } from '@/components/submission-view';
import { btn, Card, ErrorNotice, input, label, Notice, PageHeader } from '@/components/ui';

export const metadata = { title: '제출 검토' };

async function begin(f: FormData) {
  'use server';
  const id = String(f.get('id'));
  await withStaff((ctx) => startReview(ctx, id));
  redirect(`/review/submissions/${id}`);
}
async function feedback(f: FormData) {
  'use server';
  const id = String(f.get('id'));
  await orRedirectWithError(`/review/submissions/${id}`, () => withStaff((ctx) => addFeedback(ctx, id, {
    content: String(f.get('content') ?? ''), status: String(f.get('status') ?? 'comment'),
    checklist: String(f.get('checklist') ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
  })));
  redirect(`/review/submissions/${id}?sent=1`);
}

export default async function ReviewDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { id } = await params;
  const { error, sent } = await searchParams;
  const s = await withStaff((ctx) => getSubmission(ctx, id));
  return (
    <>
      <PageHeader title="제출 검토" actions={<Link href="/review/submissions" className={btn.secondary}>검토함</Link>} />
      <ErrorNotice message={error} />
      {sent && <div className="mb-3"><Notice tone="ok">피드백을 보냈습니다.</Notice></div>}
      {s.status === 'submitted' && (
        <form action={begin} className="mb-4"><input type="hidden" name="id" value={s.id} /><button className={btn.secondary}>검토 시작</button></form>
      )}
      <SubmissionView s={s} />
      <Card className="mt-4">
        <h2 className="font-semibold">피드백 작성</h2>
        <p className="mt-1 text-xs text-muted">코멘트와 체크리스트만 남깁니다. 학생 원문은 수정되지 않습니다.</p>
        <form action={feedback} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={s.id} />
          <div><label htmlFor="content" className={label}>코멘트</label><textarea id="content" name="content" required rows={4} maxLength={10000} className={input} /></div>
          <div><label htmlFor="checklist" className={label}>체크리스트 (한 줄에 하나, 선택)</label><textarea id="checklist" name="checklist" rows={3} className={input} /></div>
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className={label}>상태</legend>
            <label><input type="radio" name="status" value="comment" defaultChecked /> 코멘트만</label>
            <label><input type="radio" name="status" value="changes_requested" /> 수정 요청</label>
            <label><input type="radio" name="status" value="feedback_complete" /> 피드백 완료</label>
          </fieldset>
          <button className={btn.primary}>보내기</button>
        </form>
      </Card>
    </>
  );
}
