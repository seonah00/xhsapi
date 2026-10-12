'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { repairableCoverIds, type CoverCandidate } from './cover-repair-state';
import { btn } from './ui';

const FailureContext = createContext<((id: string, src: string) => void) | null>(null);
export const useCoverFailure = () => useContext(FailureContext);

/** Browser failures can use an administrator's bounded maintenance policy. */
export function CoverRepair({ notes, children, canManage = false, automatic = false }: { automatic?: boolean; canManage?: boolean; notes: CoverCandidate[]; children: React.ReactNode }) {
  const [failedSources, setFailedSources] = useState<Record<string, string>>({});
  const report = useCallback((id: string, src: string) => {
    setFailedSources(prev => prev[id] === src ? prev : { ...prev, [id]: src });
  }, []);
  const ids = repairableCoverIds(notes, failedSources);
  const latestIds = useRef(ids);
  const router = useRouter();
  useEffect(() => { latestIds.current = ids; }, [ids]);
  useEffect(() => {
    if (!automatic) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (jobId: string, remaining: number) => {
      try {
        const r = await fetch(`/api/covers/automatic/${jobId}`, {cache:'no-store',signal:controller.signal});
        if (!r.ok || controller.signal.aborted) return;
        const {data} = await r.json();
        if (data?.state === 'succeeded') { router.refresh(); return; }
        if (remaining > 0 && ['queued','running','waiting_external'].includes(data?.state)) timer = setTimeout(() => void poll(jobId,remaining-1),3000);
      } catch { /* Keep the placeholder; never automatically resubmit a paid request. */ }
    };
    timer = setTimeout(() => {
      if (!latestIds.current.length) return;
      void fetch('/api/covers/automatic', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({noteIds:latestIds.current}),signal:controller.signal})
        .then(async r => { if (r.ok && !controller.signal.aborted) { const {data} = await r.json(); if(data?.jobId) await poll(data.jobId,40); } })
        .catch(() => { /* Existing images remain usable if maintenance is unavailable. */ });
    },1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [automatic, router]);
  return <FailureContext.Provider value={report}>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span>이 페이지에 {notes.length}건 표시 · 페이지당 최대 50건</span>
      {canManage && ids.length > 0 && <Link className={btn.secondary} href={`/app/notes/enrich?ids=${ids.join(',')}`}>이미지 업데이트 ({ids.length}건)</Link>}
      {canManage && ids.length > 0 && <span className="text-xs text-muted">불러오지 못한 이미지를 다시 조회합니다. 실행 전에 비용을 확인합니다.</span>}
    </div>
    {children}
  </FailureContext.Provider>;
}
