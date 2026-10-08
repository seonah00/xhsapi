'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { btn, input, label } from '@/components/ui';

export function DictionaryUploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const file = data.get('dictionaryFile');
    if (!(file instanceof File) || file.size === 0 || file.size > 2 * 1024 * 1024) {
      setError('비어 있지 않은 2MB 이하 JSON 파일을 선택하세요.');
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch('/admin/dictionary/import', {
        method: 'POST', body: data, credentials: 'same-origin', mode: 'cors',
        // Native navigation POSTs under the site's no-referrer policy can send
        // Origin:null. Only this same-origin upload retains its origin; the
        // server still rejects missing/null/cross-site origins and bounds bytes.
        referrerPolicy: 'same-origin',
      });
      const target = new URL(response.url);
      if (!response.ok || target.origin !== window.location.origin || !/^\/admin\/dictionary(?:\/|$)/.test(target.pathname)) {
        throw new Error('UPLOAD_FAILED');
      }
      router.push(target.pathname + target.search);
      router.refresh();
    } catch {
      setError('가져오지 못했습니다. 관리자 로그인 상태와 파일 형식을 확인하세요.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label htmlFor="dictionary-label" className={label}>가져오기 이름</label>
        <input id="dictionary-label" name="label" maxLength={120} placeholder="예: 2026-10 편집 사전" className={input} disabled={pending} />
      </div>
      <div>
        <label htmlFor="dictionary-file" className={label}>JSON 파일 (최대 2MB)</label>
        <input id="dictionary-file" name="dictionaryFile" type="file" accept="application/json,.json" required disabled={pending} className={`${input} file:mr-3 file:rounded-lg file:border-0 file:bg-bg file:px-2 file:py-1 file:text-xs`} />
      </div>
      <button className={btn.primary} disabled={pending}>{pending ? '가져오는 중…' : '가져와서 미리보기'}</button>
      {error && <p role="alert" className="text-sm text-accent sm:col-span-3">{error}</p>}
    </form>
  );
}
