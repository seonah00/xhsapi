'use client';
import { useEffect, useState } from 'react';

/** App-relative copies resolve only at click time, so SSR never guesses the user's origin. */
export function CopyButton({ text, label, appRelative = false }: { text: string; label: string; appRelative?: boolean }) {
  const [status, setStatus] = useState<'idle'|'done'|'error'>('idle');
  useEffect(()=>{
    if(status!=='done')return;
    const timer=setTimeout(()=>setStatus('idle'),1500);
    return ()=>clearTimeout(timer);
  },[status]);
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(appRelative ? `${window.location.origin}${text}` : text);
      setStatus('done');
    } catch { setStatus('error'); }
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" onClick={()=>void copy()} className="min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-xs">{status==='done'?'복사됨':label}</button>
    {status!=='idle' && <span role="status" className="text-xs text-muted">{status==='error'?'복사하지 못했습니다. 브라우저 권한을 확인하고 다시 시도하세요.':'클립보드에 복사했습니다.'}</span>}
  </span>;
}
