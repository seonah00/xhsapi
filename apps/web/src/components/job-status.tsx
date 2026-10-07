'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const JOB_TERMINAL = ['succeeded', 'partial', 'failed', 'cancelled', 'unknown_outcome'];
const TRANSCRIPT_TERMINAL = ['succeeded', 'failed', 'no_speech', 'unknown_outcome'];
const LABEL: Record<string, string> = {
  queued: '대기 중', running: '실행 중', waiting_external: '외부 처리 대기', submitted: '제출됨', processing: '처리 중',
  succeeded: '완료', partial: '일부 완료', failed: '실패', cancelled: '취소됨', unknown_outcome: '결과 확인 필요', no_speech: '말소리 없음',
};

function usePoll(url: string, terminal: string[], initial: string) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [progress, setProgress] = useState<{notes?:number;targetCount?:number;pages?:number;stopReason?:string;completed?:number;total?:number;covers?:number}|null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const body = await res.json();
        const s = (body?.data?.state ?? body?.data?.status) as string | undefined;
        if (s) setState(s);
        if (body?.data?.progress) setProgress(body.data.progress);
        if (s && terminal.includes(s)) { router.refresh(); return; }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; };
  }, [url, terminal, router]);
  return {state,progress};
}

function Box({ label, state, terminal }: { label: string; state: string; terminal: string[] }) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl bg-info-soft px-4 py-3 text-sm text-info">
      {label}: <strong>{LABEL[state] ?? state}</strong>{!terminal.includes(state) && ' …'}
    </div>
  );
}

/** Polls a job and refreshes the server page when it finishes. */
export function JobStatus({ jobId, label }: { jobId: string; label: string }) {
  const {state,progress} = usePoll(`/api/v1/jobs/${jobId}`, JOB_TERMINAL, 'queued');
  const [msg, setMsg] = useState<string | null>(null);
  const cancel = async () => {
    const res = await fetch(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
    setMsg(res.ok ? '취소를 요청했습니다. 이미 외부로 보낸 작업과 비용은 취소가 보장되지 않습니다.' : '이미 실행 중이거나 끝난 작업은 취소할 수 없습니다.');
  };
  return (
    <div className="space-y-1">
      {progress?.notes !== undefined && <p className="text-sm">중복 제외 {progress.notes}건 확보 / 목표 {progress.targetCount ?? '—'}건 · {progress.pages}페이지 조회</p>}
      {progress?.stopReason && <p className="text-xs text-muted">{({target_reached:'수집 목표에 도달했습니다.',provider_exhausted:'공급자가 제공하는 결과가 끝났습니다.',repeated_page:'같은 페이지가 반복되어 추가 조회를 멈췄습니다.',page_limit:'승인한 페이지 한도에 도달했습니다.'} as Record<string,string>)[progress.stopReason]}</p>}
      {progress?.completed !== undefined && <p className="text-sm">상세 보완 {progress.completed}/{progress.total}건 · 표지 주소 확보 {progress.covers ?? 0}건</p>}
      <Box label={label} state={state} terminal={JOB_TERMINAL} />
      {(state === 'queued' || state === 'waiting_external') && <button type="button" onClick={() => void cancel()} className="text-xs text-muted underline">작업 취소</button>}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}

/** Polls the transcript run itself (submit + async result polling), not just the submit job. */
export function TranscriptStatus({ referenceId, initial }: { referenceId: string; initial: string }) {
  const {state} = usePoll(`/api/v1/references/${referenceId}/transcript`, TRANSCRIPT_TERMINAL, initial);
  return <Box label="추출 진행" state={state} terminal={TRANSCRIPT_TERMINAL} />;
}
