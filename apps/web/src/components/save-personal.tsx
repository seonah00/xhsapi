'use client';
import {useActionState} from 'react';
import Link from 'next/link';
import {savePersonalAction} from '@/app/app/dictionary/mine/actions';
import {btn,input} from './ui';
export function SavePersonal({source}:{source:unknown}) {
 const [state,action,pending]=useActionState(savePersonalAction,{});
 return <form action={action} className="mt-2"><input type="hidden" name="source" value={JSON.stringify(source)}/><button disabled={pending} className={btn.small}>{pending?'저장 중…':'내 사전에 저장'}</button>{state.id&&<span role="status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">저장됨 <Link href="/app/dictionary/mine" className="inline-flex min-h-11 items-center underline">내 사전 보기</Link><Link href={`/app/write?ids=${state.id}`} className="inline-flex min-h-11 items-center underline">바로 글쓰기</Link></span>}{state.error&&<p role="alert">{state.error}</p>}</form>;
}
export function ManualPersonal() {
 const [state,action,pending]=useActionState(savePersonalAction,{});
 return <form action={action} className="my-4 grid gap-2 rounded-xl border border-line p-3"><h2 className="font-semibold">직접 등록</h2><label>종류<select name="entryType" className={input}><option value="expression">표현</option><option value="tag">태그</option></select></label><label>중국어 태그·표현<input name="term" maxLength={120} required className={input}/></label><label>내가 정리한 뜻<textarea name="meaning" maxLength={1000} className={input}/></label><p className="text-xs text-muted">직접 등록한 항목은 실사용 검증 결과로 표시하지 않습니다.</p><button disabled={pending} className={btn.secondary}>내 항목 등록</button>{state.id&&<span role="status"><Link className="inline-flex min-h-11 items-center underline" href={`/app/write?ids=${state.id}`}>등록 완료 · 바로 글쓰기</Link></span>}{state.error&&<p role="alert">{state.error}</p>}</form>;
}
