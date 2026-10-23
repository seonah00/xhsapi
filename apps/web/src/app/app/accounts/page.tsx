import Link from 'next/link';
import { listAccounts, TONE_LABELS } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { Badge, Card, Empty, LinkButton, PageHeader } from '@/components/ui';
import { fmtDate, formatLabel, topicLabel } from '@/components/labels';

export const metadata = { title: '내 계정' };

export default async function AccountsPage() {
  const accounts = await withPageCtx((ctx) => listAccounts(ctx));
  return (
    <>
      <PageHeader title="내 계정" description="계정별 주제·독자·말투를 정리하세요. 계정은 최대 3개까지 등록할 수 있습니다."
        actions={<>{accounts.length < 3 && <LinkButton href="/app/accounts/new" variant="primary">+ 계정 추가</LinkButton>}<LinkButton href="/app/privacy">개인정보·데이터 삭제</LinkButton></>} />
      {accounts.length === 0 ? (
        <Empty title="아직 계정이 없습니다"><Link className="text-accent underline" href="/app/accounts/new">계정 방향 설정하기</Link></Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold">{a.display_name}</h2>
                  <p className="text-xs text-muted">{fmtDate(a.updated_at.toISOString())} 수정</p>
                </div>
                <LinkButton href={`/app/accounts/${a.id}/settings`}>수정</LinkButton>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge tone="accent">주력 {topicLabel(a.profile.mainTopic)}</Badge>
                {a.profile.topics.filter((t) => t !== a.profile.mainTopic).map((t) => <Badge key={t}>{topicLabel(t)}</Badge>)}
                {a.profile.formats.map((f) => <Badge key={f} tone="info">{formatLabel(f)}</Badge>)}
                <Badge>{TONE_LABELS[a.profile.tone]}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">독자: {a.profile.audience}</p>
              <Link href={`/app/results?account=${a.id}`} className="mt-3 inline-block text-sm text-accent">성과 기록 보기 →</Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
