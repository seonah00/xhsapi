'use client';
import { useActionState } from 'react';
import { checkAction, type CheckState } from './actions';
import { Results } from './results';

const box = 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm zh';
export function CheckForm() {
  const [state, action, pending] = useActionState<CheckState, FormData>(checkAction, {});
  const s = state.sections;
  return (
    <>
      <form action={action} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <label className="block text-sm">제목<input name="title" defaultValue={s?.title} maxLength={100} className={`${box} mt-1`} /></label>
        <label className="block text-sm">표지 문구<input name="cover" defaultValue={s?.cover} maxLength={100} className={`${box} mt-1`} /></label>
        <label className="block text-sm">본문 (최대 10,000자)<textarea name="body" defaultValue={s?.body} rows={8} maxLength={10000} className={`${box} mt-1`} /></label>
        <label className="block text-sm">해시태그<input name="tags" defaultValue={s?.tags.join(', ')} className={`${box} mt-1`} /></label>
        <label className="block text-sm">자막<textarea name="subtitles" defaultValue={s?.subtitles} rows={2} className={`${box} mt-1`} /></label>
        <label className="block text-sm">광고·협찬 여부
          <select name="sponsorship" defaultValue="unknown" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"><option value="unknown">미확인</option><option value="no">아님</option><option value="yes">광고·협찬임</option></select></label>
        <button disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? '점검 중…' : '점검'}</button>
      </form>
      {state.error && <p role="alert" className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">{state.error}</p>}
      {state.findings && <Results state={state} />}
    </>
  );
}
