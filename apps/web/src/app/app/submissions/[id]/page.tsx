import Link from 'next/link';
import { getSubmission } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { SubmissionView } from '@/components/submission-view';
import { btn, PageHeader } from '@/components/ui';

export const metadata = { title: '제출 상세' };

export default async function MySubmission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await withPageCtx((ctx) => getSubmission(ctx, id));
  return (
    <>
      <PageHeader title="제출 상세" actions={<Link href="/app/submissions" className={btn.secondary}>목록</Link>} />
      <SubmissionView s={s} />
    </>
  );
}
