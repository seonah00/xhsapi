'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

/** Uploads through the app API (files go to private storage; no public URLs). */
export function Uploader({ purpose, referenceId, planId, label, accept = 'image/jpeg,image/png,image/webp' }: { purpose: string; referenceId?: string; planId?: string; label: string; accept?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const upload = async () => {
    const files = input.current?.files;
    if (!files?.length) return;
    const fd = new FormData();
    fd.set('purpose', purpose);
    if (referenceId) fd.set('referenceId', referenceId);
    if (planId) fd.set('planId', planId);
    for (const f of Array.from(files)) fd.append('files', f);
    setState({ busy: true, error: null });
    const res = await fetch('/api/v1/assets', { method: 'POST', body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setState({ busy: false, error: body?.error?.messageKo ?? '업로드에 실패했습니다.' });
      return;
    }
    if (input.current) input.current.value = '';
    setState({ busy: false, error: null });
    router.refresh();
  };
  return (
    <div className="text-sm">
      <label className="block">{label}
        <input ref={input} type="file" multiple accept={accept} onChange={() => void upload()} disabled={state.busy} className="mt-1 block w-full text-xs file:mr-2 file:rounded-lg file:border file:border-line file:bg-surface file:px-2 file:py-1" />
      </label>
      <p className="mt-1 text-xs text-muted">JPG·PNG·WebP{accept.includes('pdf') ? '·PDF' : ''}, 파일당 10MB, 한 번에 5개. 위치·기기 정보(EXIF)는 저장 전에 지웁니다.</p>
      {state.busy && <p role="status" className="text-xs text-info">올리는 중…</p>}
      {state.error && <p role="alert" className="text-xs text-accent">{state.error}</p>}
    </div>
  );
}
