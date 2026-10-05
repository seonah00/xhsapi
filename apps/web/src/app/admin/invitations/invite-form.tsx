'use client';
import { useActionState, useState } from 'react';
import { createInviteAction, type InviteState } from './actions';

const input = 'rounded-xl border border-line bg-surface px-3 py-2 text-sm';

export function InviteForm({ cohorts }: { cohorts: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInviteAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">역할
          <select name="role" defaultValue="student" className={`${input} mt-1 w-full`}><option value="student">학생</option><option value="reviewer">강사</option><option value="org_admin">관리자</option></select>
        </label>
        <label className="text-sm">기수 (선택)
          <select name="cohortId" defaultValue="" className={`${input} mt-1 w-full`}><option value="">지정 안 함</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="text-sm">받는 사람 메모 (선택)
          <input name="email" type="email" placeholder="이메일(발송 안 함)" className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-sm">유효 기간
          <select name="expiresInDays" defaultValue="7" className={`${input} mt-1 w-full`}>{[1, 3, 7].map((d) => <option key={d} value={d}>{d}일</option>)}</select>
        </label>
        <div className="flex items-end"><button disabled={pending} className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50">{pending ? '만드는 중…' : '초대 링크 만들기'}</button></div>
      </form>
      {state.error && <p role="alert" className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">{state.error}</p>}
      {state.link && (
        <div role="status" className="mt-3 rounded-xl bg-ok-soft p-4 text-sm text-ok">
          <p className="font-medium">초대 링크가 만들어졌습니다. 이 화면을 벗어나면 다시 볼 수 없습니다.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-surface px-2 py-1 text-xs text-ink" data-testid="invite-link">{state.link}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(state.link!).then(() => setCopied(true))} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink">{copied ? '복사됨' : '복사'}</button>
          </div>
          <p className="mt-2 text-xs">메일은 자동 발송되지 않습니다. 링크를 직접 전달하세요. 한 번만 사용할 수 있습니다.</p>
        </div>
      )}
    </div>
  );
}
