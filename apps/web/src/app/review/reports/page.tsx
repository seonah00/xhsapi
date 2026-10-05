import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { listReports, resolveReport } from '@xhs/core';
import { withStaff } from '@/server/staff';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, Empty, ErrorNotice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '오류·권리 신고' };

const TARGET: Record<string, string> = { analysis: '레퍼런스 분석', check_finding: '점검 결과', library_item: '자료실', transcript: '음성 문안 추출', note: '저장 자료' };
const REASON: Record<string, string> = { incorrect: '내용이 틀림', false_positive: '오탐', missed_issue: '놓친 문제', rights_issue: '권리 침해', source_removed: '원본 삭제', other: '기타' };

async function resolve(f: FormData) {
  'use server';
  const id = z.string().uuid().parse(f.get('id'));
  const status = z.enum(['resolved', 'dismissed']).parse(f.get('status'));
  await orRedirectWithError('/review/reports', () => withStaff((ctx) => resolveReport(ctx, id, status)));
  redirect('/review/reports');
}

export default async function Reports({ searchParams }: { searchParams: Promise<{ all?: string; error?: string }> }) {
  const sp = await searchParams;
  const rows = await withStaff((ctx) => listReports(ctx, sp.all ? 'all' : 'open'));
  const byRule = Object.entries(rows.filter((r) => r.reason === 'false_positive' && r.ruleKey).reduce<Record<string, number>>((m, r) => ({ ...m, [r.ruleKey!]: (m[r.ruleKey!] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      <PageHeader title="오류·권리 신고" description="학생이 보낸 신고입니다. 대상 ID·사유·짧은 메모만 받으며 학생의 비공개 원문은 여기 표시되지 않습니다."
        actions={<Link href={sp.all ? '/review/reports' : '/review/reports?all=1'} className={btn.secondary}>{sp.all ? '열린 신고만' : '처리한 신고 포함'}</Link>} />
      <ErrorNotice message={sp.error} />
      {byRule.length > 0 && (
        <Card className="mb-4">
          <h2 className="font-semibold">오탐 신고가 많은 규칙</h2>
          <ul className="mt-2 space-y-1 text-sm">{byRule.map(([k, n]) => <li key={k}><code>{k}</code> · {n}건</li>)}</ul>
          <p className="mt-2 text-xs text-muted"><Link href="/review/rules" className="underline">점검 규칙</Link>에서 새 버전으로 조정하세요. 기존 결과는 바뀌지 않습니다.</p>
        </Card>
      )}
      {rows.length === 0 ? <Empty title="신고가 없습니다" /> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={r.reason === 'rights_issue' || r.reason === 'source_removed' ? 'warn' : 'info'}>{REASON[r.reason] ?? r.reason}</Badge>
                  <span className="font-medium">{TARGET[r.targetType] ?? r.targetType}</span>
                  {r.ruleKey && <code className="text-xs">{r.ruleKey}</code>}
                  {r.status !== 'open' && <Badge tone="ok">{r.status === 'resolved' ? '처리함' : '기각'}</Badge>}
                </div>
                {r.note && <p className="mt-1">메모: {r.note}</p>}
                <p className="mt-1 text-xs text-muted">{fmtDate(r.createdAt, true)} · 대상 {r.targetId.slice(0, 8)}
                  {r.targetType === 'library_item' && <> · <Link href="/review/library" className="underline">자료실 검토</Link>(권리·원본 신고는 즉시 비공개 처리됨)</>}</p>
              </div>
              {r.status === 'open' && (
                <div className="flex gap-1">
                  <form action={resolve}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="resolved" /><button className={btn.small}>처리 완료</button></form>
                  <form action={resolve}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="dismissed" /><button className={btn.ghost}>기각</button></form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
