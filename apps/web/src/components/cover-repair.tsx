'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useState } from 'react';
import { repairableCoverIds, type CoverCandidate } from './cover-repair-state';
import { btn } from './ui';

const FailureContext = createContext<((id: string, src: string) => void) | null>(null);
export const useCoverFailure = () => useContext(FailureContext);

/** Collect browser failures locally. Updating images still requires a cost confirmation. */
export function CoverRepair({ notes, children, canManage = false }: { canManage?: boolean; notes: CoverCandidate[]; children: React.ReactNode }) {
  const [failedSources, setFailedSources] = useState<Record<string, string>>({});
  const report = useCallback((id: string, src: string) => {
    setFailedSources(prev => prev[id] === src ? prev : { ...prev, [id]: src });
  }, []);
  const ids = repairableCoverIds(notes, failedSources);
  return <FailureContext.Provider value={report}>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span>이 페이지에 {notes.length}건 표시 · 페이지당 최대 50건</span>
      {canManage && ids.length > 0 && <Link className={btn.secondary} href={`/app/notes/enrich?ids=${ids.join(',')}`}>이미지 업데이트 ({ids.length}건)</Link>}
      {canManage && ids.length > 0 && <span className="text-xs text-muted">불러오지 못한 이미지를 다시 조회합니다. 실행 전에 비용을 확인합니다.</span>}
    </div>
    {children}
  </FailureContext.Provider>;
}
