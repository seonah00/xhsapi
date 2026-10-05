'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanDraft } from '@xhs/core';

type Status = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
const STATUS_TEXT: Record<Status, string> = { saved: '저장됨', dirty: '수정 중…', saving: '저장 중…', conflict: '다른 곳에서 수정됨 — 새로고침 필요', error: '저장 실패 — 다시 시도 중' };
const box = 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm';
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function PlanEditor({ planId, initial, initialRevision, hasUnversionedChanges }: { planId: string; initial: PlanDraft; initialRevision: number; hasUnversionedChanges: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<Status>('saved');
  const [unversioned, setUnversioned] = useState(hasUnversionedChanges);
  const revision = useRef(initialRevision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setStatus('saving');
    const res = await fetch(`/api/v1/plans/${planId}/draft`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: latest.current, revision: revision.current }) });
    if (res.status === 409) { setStatus('conflict'); return false; }
    if (!res.ok) { setStatus('error'); return false; }
    revision.current = (await res.json()).data.revision;
    setStatus('saved');
    setUnversioned(true);
    return true;
  }, [planId]);

  const update = (next: PlanDraft) => {
    setDraft(next);
    if (status === 'conflict') return;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 1000);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const saveVersion = async () => {
    if (status === 'dirty' && !(await flush())) return;
    setStatus('saving');
    const res = await fetch(`/api/v1/plans/${planId}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: revision.current }) });
    if (res.status === 409) { setStatus('conflict'); return; }
    setStatus('saved');
    setUnversioned(false);
    router.refresh();
  };

  const c = draft.content;
  const f = draft.facts;
  const setC = (patch: Partial<PlanDraft['content']>) => update({ ...draft, content: { ...c, ...patch } });
  const setF = (patch: Partial<PlanDraft['facts']>) => update({ ...draft, facts: { ...f, ...patch } });
  const length = [...c.body].length;

  return (
    <div className="space-y-4">
      <div className="sticky top-[106px] z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 backdrop-blur">
        <span role="status" aria-live="polite" className={`text-xs ${status === 'conflict' || status === 'error' ? 'text-accent' : 'text-muted'}`} data-testid="autosave-status">{STATUS_TEXT[status]}</span>
        <div className="flex items-center gap-2">
          {unversioned && <span className="text-xs text-warn">버전으로 저장되지 않은 변경이 있습니다</span>}
          {status === 'conflict' ? <button onClick={() => window.location.reload()} className="rounded-lg border border-line px-3 py-1.5 text-xs">새로고침</button>
            : <button onClick={() => void saveVersion()} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-bg">버전 저장</button>}
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-semibold">사실 입력 <span className="text-xs font-normal text-muted">AI는 여기 없는 경험·효과·수치를 만들지 않습니다</span></h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">실제로 다룰 대상·장소·제품·경험<input value={f.subject} onChange={(e) => setF({ subject: e.target.value })} maxLength={200} className={`${box} zh mt-1`} /></label>
          <label className="text-sm">확인된 사실 (한 줄에 하나)<textarea value={f.confirmedFacts.join('\n')} onChange={(e) => setF({ confirmedFacts: lines(e.target.value) })} rows={4} className={`${box} zh mt-1`} /></label>
          <label className="text-sm">아직 모르는 사실 (한 줄에 하나)<textarea value={f.unknownFacts.join('\n')} onChange={(e) => setF({ unknownFacts: lines(e.target.value) })} rows={4} className={`${box} mt-1`} /></label>
          <label className="text-sm">직접 촬영할 수 있는 장면 (한 줄에 하나)<textarea value={f.shootableScenes.join('\n')} onChange={(e) => setF({ shootableScenes: lines(e.target.value) })} rows={3} className={`${box} zh mt-1`} /></label>
          <label className="text-sm">촬영 시간·조건<textarea value={f.shootingConditions} onChange={(e) => setF({ shootingConditions: e.target.value })} rows={3} className={`${box} mt-1`} /></label>
          <label className="text-sm">광고·협찬 여부
            <select value={f.sponsorship} onChange={(e) => setF({ sponsorship: e.target.value as 'yes' | 'no' | 'unknown' })} className={`${box} mt-1`}>
              <option value="unknown">미확인</option><option value="no">아님</option><option value="yes">광고·협찬임</option></select></label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label>사용 기간 (선택)<input value={f.usagePeriod ?? ''} onChange={(e) => setF({ usagePeriod: e.target.value || undefined })} className={`${box} mt-1`} /></label>
            <label>방문일 (선택)<input value={f.visitDate ?? ''} onChange={(e) => setF({ visitDate: e.target.value || undefined })} className={`${box} mt-1`} /></label>
            <label>가격 (선택)<input value={f.price ?? ''} onChange={(e) => setF({ price: e.target.value || undefined })} className={`${box} mt-1`} /></label>
            <label>결과 (선택)<input value={f.results ?? ''} onChange={(e) => setF({ results: e.target.value || undefined })} className={`${box} mt-1`} /></label>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-semibold">문안</h2>
        <div className="mt-3 grid gap-3">
          <label className="text-sm">기획 의도<textarea value={c.intent} onChange={(e) => setC({ intent: e.target.value })} rows={2} className={`${box} mt-1`} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">제목 (중국어)<input value={c.title} onChange={(e) => setC({ title: e.target.value })} maxLength={100} className={`${box} zh mt-1`} /></label>
            <label className="text-sm">표지 문구<input value={c.cover} onChange={(e) => setC({ cover: e.target.value })} maxLength={100} className={`${box} zh mt-1`} /></label>
          </div>
          <label className="text-sm">본문 (중국어) <span className="text-xs text-muted">{length.toLocaleString()} / 10,000자</span>
            <textarea value={c.body} onChange={(e) => setC({ body: e.target.value })} rows={8} maxLength={10000} className={`${box} zh mt-1`} /></label>
          <label className="text-sm">한국어 의미 설명<textarea value={c.meaningKo} onChange={(e) => setC({ meaningKo: e.target.value })} rows={4} className={`${box} mt-1`} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">해시태그 (쉼표 구분)<input value={c.tags.join(', ')} onChange={(e) => setC({ tags: e.target.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean) })} className={`${box} zh mt-1`} /></label>
            <label className="text-sm">자막<textarea value={c.subtitles} onChange={(e) => setC({ subtitles: e.target.value })} rows={2} className={`${box} zh mt-1`} /></label>
          </div>
          <div className="text-sm">
            <p>장면별 촬영표</p>
            <ol className="mt-1 space-y-1">
              {c.shots.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <input aria-label={`장면 ${i + 1}`} value={s.scene} onChange={(e) => setC({ shots: c.shots.map((x, j) => (j === i ? { ...x, scene: e.target.value } : x)) })} className={box} />
                  <input aria-label={`장면 ${i + 1} 메모`} value={s.note} onChange={(e) => setC({ shots: c.shots.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} className={box} />
                  <button type="button" onClick={() => setC({ shots: c.shots.filter((_, j) => j !== i) })} className="text-xs text-muted" aria-label={`장면 ${i + 1} 삭제`}>삭제</button>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setC({ shots: [...c.shots, { scene: '', note: '' }] })} className="mt-1 text-xs text-accent">+ 장면 추가</button>
          </div>
        </div>
      </section>
    </div>
  );
}
