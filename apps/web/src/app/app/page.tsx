import Link from 'next/link';
import { homeData } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { getCompareIds } from './discover/actions';
import { NoteCard } from '@/components/note-card';
import { Badge, Card, Empty, LinkButton, Notice, PageHeader } from '@/components/ui';
import { fmtDate, formatLabel, topicLabel } from '@/components/labels';
import { PLAN_STATUS, SUBMISSION_STATUS } from '@/components/plan-labels';

export const metadata = { title: '홈' };

export default async function Home({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const [data, compare] = await Promise.all([withPageCtx((ctx) => homeData(ctx, account ?? null)), getCompareIds()]);
  if (!data.current) {
    return (
      <>
        <PageHeader title="시작하기" />
        <Empty title="먼저 계정 방향을 설정하세요">
          <p>주제·독자·촬영 가능한 형식을 알려주면 맞춤 레퍼런스를 골라 드립니다.</p>
          <div className="mt-3"><LinkButton href="/app/accounts/new" variant="primary">계정 방향 설정</LinkButton></div>
        </Empty>
      </>
    );
  }
  const p = data.current.profile;
  const stale = data.lastFetchedAt && Date.now() - Date.parse(data.lastFetchedAt) > 3 * 86_400_000;
  return (
    <>
      <PageHeader title="홈" description={<>자료 마지막 갱신: {fmtDate(data.lastFetchedAt, true)}{stale && <Badge tone="warn">오래된 자료</Badge>}</>} />
      {data.accounts.length > 1 && (
        <nav aria-label="계정 선택" className="mb-4 flex flex-wrap gap-2">
          {data.accounts.map((a) => (
            <Link key={a.id} href={`/app?account=${a.id}`} aria-current={a.id === data.current!.id ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${a.id === data.current!.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface'}`}>{a.display_name}</Link>
          ))}
        </nav>
      )}
      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{data.current.display_name}</h2>
            <p className="mt-1 text-sm text-muted">독자: {p.audience}</p>
          </div>
          <LinkButton href={`/app/accounts/${data.current.id}/settings`}>방향 수정</LinkButton>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          <Badge tone="accent">주력 {topicLabel(p.mainTopic)}</Badge>
          {p.formats.map((f) => <Badge key={f} tone="info">{formatLabel(f)}</Badge>)}
        </div>
      </Card>

      <section aria-labelledby="rec" className="mb-8">
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 id="rec" className="text-lg font-semibold">맞춤 레퍼런스</h2>
          <Link href="/app/discover" className="text-sm text-accent">더 탐색 →</Link>
        </div>
        <p className="mb-3 text-xs text-muted">저장된 자료 {data.sampleSize}개 중 계정 적합성·촬영 가능성 순으로 골랐습니다. 성공 확률이나 공식 지수가 아닙니다. (규칙 {data.rankingVersion})</p>
        {data.recommendations.length === 0 ? (
          <Empty title="계정에 맞는 자료가 아직 부족합니다">관련 없는 인기 자료로 채우지 않았습니다. 탐색에서 검색어를 바꿔 보세요.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.recommendations.map((r) => <NoteCard key={r.note.id} note={r.note} back="/app" inCompare={compare.includes(r.note.id)} reasons={r.reasons} cons={r.cons} />)}
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="font-semibold">진행 중 기획</h2>
          {data.activePlans.length === 0 ? <p className="mt-2 text-sm text-muted">아직 기획이 없습니다. <Link href="/app/plans/new" className="text-accent underline">새 기획</Link></p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.activePlans.map((pl) => <li key={pl.id}><Link href={`/app/plans/${pl.id}`} className="underline">{pl.title}</Link> <Badge>{PLAN_STATUS[pl.status] ?? pl.status}</Badge></li>)}</ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">저장한 표현</h2>
          {data.savedExpressions.length === 0 ? <p className="mt-2 text-sm text-muted">표현 사전에서 저장하면 여기에 보입니다.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.savedExpressions.map((e) => <li key={e.id}><span className="zh" lang="zh-CN">{e.expression}</span> <span className="text-muted">{e.meaning}</span></li>)}</ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">강사 피드백</h2>
          {data.feedback.length === 0 ? <p className="mt-2 text-sm text-muted">제출한 기획이 없습니다.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.feedback.map((f) => <li key={f.submissionId}><Link href={`/app/submissions/${f.submissionId}`} className="underline">{f.latest ?? '검토 대기'}</Link> <Badge>{SUBMISSION_STATUS[f.status]?.[0] ?? f.status}</Badge></li>)}</ul>
          )}
        </Card>
      </div>
      <div className="mt-6"><Notice>추천·분석·점검 결과는 참고용입니다. 게시 승인이나 노출을 보장하지 않습니다.</Notice></div>
    </>
  );
}
