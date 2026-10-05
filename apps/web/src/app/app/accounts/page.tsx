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
      <PageHeader title="내 계정" description="계정 방향은 추천과 기획의 기준이 됩니다. 사용자당 활성 계정은 최대 3개입니다."
        actions={accounts.length < 3 ? <LinkButton href="/app/accounts/new" variant="primary">+ 계정 추가</LinkButton> : undefined} />
      {accounts.length === 0 ? (
        <Empty title="아직 계정이 없습니다"><Link className="text-accent underline" href="/app/accounts/new">계정 방향 설정하기</Link></Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{a.display_name}</h2>
                  <p className="text-xs text-muted">프로필 버전 {a.profile_version} · {fmtDate(a.updated_at.toISOString())} 수정</p>
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
              <Link href={`/app?account=${a.id}`} className="mt-3 inline-block text-sm text-accent">이 계정 기준으로 홈 보기 →</Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
