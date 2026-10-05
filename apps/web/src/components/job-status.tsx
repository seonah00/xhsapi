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
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const body = await res.json();
        const s = (body?.data?.state ?? body?.data?.status) as string | undefined;
        if (s) setState(s);
        if (s && terminal.includes(s)) { router.refresh(); return; }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; };
  }, [url, terminal, router]);
  return state;
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
  const state = usePoll(`/api/v1/jobs/${jobId}`, JOB_TERMINAL, 'queued');
  return <Box label={label} state={state} terminal={JOB_TERMINAL} />;
}

/** Polls the transcript run itself (submit + async result polling), not just the submit job. */
export function TranscriptStatus({ referenceId, initial }: { referenceId: string; initial: string }) {
  const state = usePoll(`/api/v1/references/${referenceId}/transcript`, TRANSCRIPT_TERMINAL, initial);
  return <Box label="추출 진행" state={state} terminal={TRANSCRIPT_TERMINAL} />;
}
