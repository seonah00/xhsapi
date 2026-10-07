"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
export function AutoSearchStatus({requestId}:{requestId:string}) {
  const [state,setState]=useState('queued');
  const router=useRouter();
  useEffect(()=>{
    let stopped=false; let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const r=await fetch(`/api/search-status/${encodeURIComponent(requestId)}`,{cache:'no-store'});
        if(!r.ok) throw new Error();
        const s=await r.json();
        if(stopped) return;
        setState(s.state);
        if(['queued','running','waiting_external'].includes(s.state)) timer=setTimeout(poll,3000);
        else if(s.state==='succeeded') router.refresh();
      } catch { if(!stopped) setState('failed'); }
    };
    void poll();
    return ()=>{stopped=true;clearTimeout(timer);};
  },[requestId,router]);
  return <p role="status" className="mb-3 text-sm text-muted">{state==='succeeded'?'최신 검색 결과를 반영했습니다.': ['queued','running','waiting_external'].includes(state)?'새 게시물을 찾고 있습니다. 기존 결과를 먼저 둘러보세요.':'새 검색을 완료하지 못했습니다. 저장된 결과를 이용하세요.'}</p>;
}
