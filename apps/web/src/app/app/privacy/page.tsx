import { redirect } from 'next/navigation';
import { DELETE_CONFIRM_TEXT, enqueueDeletion, LEAVE_CONFIRM_TEXT, leaveOrganization, listMyDeletionRequests, requestDeletion } from '@xhs/core';
import { writeSession, readSession } from '@/server/session';
import { service, withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, ErrorNotice, input, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '개인정보·데이터 삭제' };
const SCOPE: Record<string, string> = { all_my_data: '데이터 삭제', leave_org: '조직 탈퇴' };
const STATE: Record<string, string> = { requested: '접수', access_blocked: '접근 차단·삭제 대기', completed: '삭제 완료', partially_retained: '삭제 완료(일부 기록 보존)' };
const LABEL: Record<string, string> = { submissions: '제출', check_runs: '점검 기록', publications_results: '발행·성과 기록', plans: '기획', transcripts: '음성 문안', analyses: '분석', library_snapshots: '자료실 사본', references: '레퍼런스', collections: '컬렉션', saves: '저장', personal_expressions: '내 표현장', reference_accounts: '참고 계정', accounts: '내 계정', assets: '파일', idempotency_keys: '요청 기록' };

async function request(f: FormData) {
  'use server';
  const id = await orRedirectWithError('/app/privacy', () => withPageCtx((ctx) => requestDeletion(ctx, String(f.get('confirm') ?? ''))));
  await service((db) => enqueueDeletion(db, id));
  redirect('/app/privacy?requested=1');
}

async function leave(f: FormData) {
  'use server';
  const id = await orRedirectWithError('/app/privacy', () => withPageCtx((ctx) => leaveOrganization(ctx, String(f.get('leaveConfirm') ?? ''))));
  await service((db) => enqueueDeletion(db, id));
  const s = await readSession();
  if (s) await writeSession(s.uid, null);
  redirect('/app/select-organization?left=1');
}

export default async function Privacy({ searchParams }: { searchParams: Promise<{ error?: string; requested?: string }> }) {
  const sp = await searchParams;
  const requests = await withPageCtx((ctx) => listMyDeletionRequests(ctx));
  return (
    <div className="max-w-2xl">
      <PageHeader title="개인정보·데이터 삭제" description="이 조직에 저장된 내 데이터를 삭제합니다. 요청 즉시 공유·제출 접근이 막히고, 7일 이내(데모에서는 바로) 삭제됩니다." />
      <ErrorNotice message={sp.error} />
      {sp.requested && <div className="mb-3"><Notice tone="ok">삭제를 요청했습니다. 자료실 공유와 강사 제출은 즉시 비공개 처리되었습니다.</Notice></div>}
      <Card>
        <h2 className="font-semibold">삭제되는 것</h2>
        <p className="mt-1 text-sm">내 계정 방향, 레퍼런스·첨부 파일, 음성 문안, 분석, 기획·버전·점검, 제출·피드백, 발행·성과 기록, 저장한 항목, 내 표현장, 공유한 자료실 사본.</p>
        <h2 className="mt-3 font-semibold">남는 것</h2>
        <p className="mt-1 text-sm">비용 원장·보안 감사 기록(문안 없이 작업 종류·시각·금액만)은 회계·보안 보존 정책(기본 90일)에 따라 유지됩니다. 조직 멤버십은 유지됩니다(조직을 떠나려면 아래 ‘조직에서 나가기’). 백업에서 즉시 지워진다고 보장하지 않습니다.</p>
        <form action={request} className="mt-4 space-y-2 text-sm">
          <label htmlFor="confirm" className="block">확인을 위해 <strong>{DELETE_CONFIRM_TEXT}</strong> 를 입력하세요</label>
          <input id="confirm" name="confirm" required autoComplete="off" className={input} />
          <button className={`${btn.primary} bg-accent`}>내 데이터 삭제 요청</button>
        </form>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">조직에서 나가기</h2>
        <p className="mt-1 text-sm">이 조직에 즉시 접근할 수 없게 되고, 위의 ‘삭제되는 것’이 모두 삭제됩니다. 진행 중인 제출은 철회됩니다. 다시 참여하려면 새 초대 링크가 필요합니다. 다른 조직의 자료에는 영향이 없습니다.</p>
        <p className="mt-1 text-xs text-muted">마지막 관리자는 다른 관리자를 지정한 뒤에 나갈 수 있습니다.</p>
        <form action={leave} className="mt-4 space-y-2 text-sm">
          <label htmlFor="leaveConfirm" className="block">확인을 위해 <strong>{LEAVE_CONFIRM_TEXT}</strong> 를 입력하세요</label>
          <input id="leaveConfirm" name="leaveConfirm" required autoComplete="off" className={input} />
          <button className={btn.secondary}>조직에서 나가기</button>
        </form>
      </Card>
      {requests.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-semibold">요청 기록</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="rounded-xl bg-bg p-3">
                <p><Badge tone={r.completedAt ? 'ok' : 'warn'}>{STATE[r.state] ?? r.state}</Badge> <Badge>{SCOPE[r.scope] ?? r.scope}</Badge> <span className="text-xs text-muted">요청 {fmtDate(r.requestedAt, true)}{r.completedAt && ` · 완료 ${fmtDate(r.completedAt, true)}`}</span></p>
                {r.summary && <p className="mt-1 text-xs">{Object.entries(r.summary).filter(([, n]) => n > 0).map(([k, n]) => `${LABEL[k] ?? k} ${n}`).join(' · ') || '삭제할 항목 없음'}</p>}
                {r.exceptionReason && <p className="mt-1 text-xs text-muted">{r.exceptionReason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
