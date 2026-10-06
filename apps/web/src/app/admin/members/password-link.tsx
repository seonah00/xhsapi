'use client';
import { useActionState, useId } from 'react';
import { passwordLinkAction, type ResetState } from './actions';

export function PasswordLinkForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(passwordLinkAction, {});
  const id = useId();
  return (
    <div className="text-sm">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="userId" value={userId} />
        <label htmlFor={id} className="flex items-center gap-1 text-xs"><input id={id} type="checkbox" name="confirm" required /> 비밀번호 링크 확인</label>
        <button disabled={pending} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-bg disabled:opacity-50">비밀번호 설정 링크</button>
      </form>
      {state.error && <p role="alert" className="mt-2 text-xs text-warn">{state.error}</p>}
      {state.link && (
        <div role="status" className="mt-2 rounded-lg bg-ok-soft p-2 text-xs text-ok">
          <p>한 번만 쓸 수 있는 링크입니다. 본인에게 직접 전달하세요(메일 발송 안 함).</p>
          <code className="mt-1 block break-all text-ink" data-testid="password-link">{state.link}</code>
        </div>
      )}
    </div>
  );
}
