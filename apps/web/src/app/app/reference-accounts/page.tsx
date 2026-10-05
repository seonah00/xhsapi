import Link from 'next/link';
import { accountCandidates, compareReferenceAccounts, listReferenceAccounts } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { formatMetric } from '@/components/metric';
import { Badge, btn, Card, Empty, ErrorNotice, input, Notice, PageHeader } from '@/components/ui';
import { TOPIC_LABEL, fmtDate, formatLabel, topicLabel } from '@/components/labels';
import { saveAccount } from './actions';

export const metadata = { title: '참고 계정' };

type SP = { q?: string; topic?: string; compare?: string | string[]; error?: string };

export default async function ReferenceAccounts({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const compareIds = ([] as string[]).concat(sp.compare ?? []).slice(0, 3);
  const d = await withPageCtx(async (ctx) => ({
    saved: await listReferenceAccounts(ctx),
    candidates: await accountCandidates(ctx, { ...(sp.q ? { q: sp.q.slice(0, 50) } : {}), ...(sp.topic ? { topic: sp.topic } : {}) }),
    compared: compareIds.length >= 2 ? await compareReferenceAccounts(ctx, compareIds) : [],
  }));
  return (
    <>
      <PageHeader title="참고 계정" description="저장된 자료에 등장한 작성자를 참고 계정으로 모아 봅니다. 내 계정과 분리되며, 내 성과와 섞어 계산하지 않습니다." />
      <ErrorNotice message={sp.error} />
      <Notice tone="warn">공급자 성장 순위·팔로워 추이는 연결 전이라 제공하지 않습니다. 아래 수치는 저장 시점의 관찰값입니다.</Notice>

      <section aria-labelledby="saved" className="mt-6">
        <h2 id="saved" className="mb-2 font-semibold">저장한 참고 계정 ({d.saved.length})</h2>
        {d.saved.length === 0 ? <Empty title="저장한 참고 계정이 없습니다">아래 후보에서 저장하세요.</Empty> : (
          <form className="space-y-2">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.saved.map((a) => (
                <li key={a.id} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/app/reference-accounts/${a.id}`} className="zh font-semibold underline">{a.displayName}</Link>
                    <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" name="compare" value={a.id} defaultChecked={compareIds.includes(a.id)} /> 비교</label>
                  </div>
                  <p className="mt-1 text-sm text-muted">팔로워 {formatMetric(a.snapshot.followers).text} · 저장 자료 {a.snapshot.noteCount}건</p>
                  <p className="mt-1 text-xs text-muted">{fmtDate(a.observedAt, true)} 관찰 {a.dataMode === 'mock' && <Badge tone="warn">데모</Badge>}</p>
                </li>
              ))}
            </ul>
            <button className={btn.secondary}>선택한 계정 비교 (2~3개)</button>
          </form>
        )}
      </section>

      {d.compared.length >= 2 && (
        <Card className="mt-4">
          <h2 className="font-semibold">참고 계정 비교</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 font-normal">계정</th><th scope="col" className="font-normal">팔로워</th><th scope="col" className="font-normal">저장 자료</th><th scope="col" className="font-normal">주제</th><th scope="col" className="font-normal">형식</th></tr></thead>
              <tbody>{d.compared.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <th scope="row" className="zh py-2 text-left font-medium">{a.displayName}</th>
                  <td>{formatMetric(a.snapshot.followers).text}</td><td>{a.snapshot.noteCount}</td>
                  <td>{a.snapshot.topics.map(topicLabel).join(', ') || '-'}</td><td>{a.snapshot.formats.map(formatLabel).join(', ') || '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">저장 자료 수는 우리 서비스에 저장된 글 수이며 계정의 전체 게시물 수가 아닙니다.</p>
        </Card>
      )}

      <section aria-labelledby="cands" className="mt-8">
        <h2 id="cands" className="mb-2 font-semibold">저장 자료의 작성자 후보</h2>
        <form role="search" className="mb-3 grid gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-[1fr_auto_auto]">
          <label className="sr-only" htmlFor="aq">작성자 또는 글 제목</label>
          <input id="aq" name="q" defaultValue={sp.q} maxLength={50} placeholder="작성자 이름 또는 글 제목" className={input} />
          <select name="topic" defaultValue={sp.topic ?? ''} className={input} aria-label="주제"><option value="">모든 주제</option>{Object.entries(TOPIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className={btn.primary}>찾기</button>
        </form>
        {d.candidates.length === 0 ? <Empty title="조건에 맞는 작성자가 없습니다" /> : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {d.candidates.map((c) => (
              <li key={c.authorRef} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="zh font-medium">{c.displayName}</p>
                  <p className="text-xs text-muted">팔로워 {formatMetric(c.followers).text} · 저장 자료 {c.noteCount}건 · {c.topics.map(topicLabel).join(', ') || '주제 미분류'}</p>
                </div>
                {c.saved ? <Badge tone="ok">저장됨</Badge> : (
                  <form action={saveAccount}><input type="hidden" name="authorRef" value={c.authorRef} /><button className={btn.small}>참고 계정으로 저장</button></form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
