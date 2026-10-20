'use client';
import {useActionState} from 'react';
import {manageWritingAction} from '@/app/app/write/history/actions';
import {btn} from './ui';
export function WritingManagement({id,revision,archived,compact=false}:{id:string;revision:number;archived:boolean;compact?:boolean}){
 const [state,action,pending]=useActionState(manageWritingAction,{});
 return <form action={action} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/><button disabled={pending} name="intent" value="duplicate" className={`${btn.secondary} min-h-11`}>글 복제</button><button disabled={pending} name="intent" value={archived?'unarchive':'archive'} className={`${btn.secondary} min-h-11`}>{archived?'보관함에서 꺼내기':'보관함으로 이동'}</button>{!compact&&<p className="w-full text-xs text-muted">복제는 마지막 저장본을 사용합니다. 보관해도 글·이전 버전·임시 저장은 유지됩니다.</p>}{state.error&&<p role="alert" className="w-full text-sm text-accent">{state.error}</p>}</form>;
}
export function RestoreWriting({id,revision,sourceRevision,disabled=false}:{id:string;revision:number;sourceRevision:number;disabled?:boolean}){
 const [state,action,pending]=useActionState(manageWritingAction,{});
 return <details className="mt-3 rounded-lg bg-bg p-3"><summary className="min-h-11 cursor-pointer py-2 font-medium">이 버전으로 복원</summary><p className="mb-3 text-sm">버전 {sourceRevision}의 내용으로 새 버전을 저장합니다. 현재 저장본과 이전 이력은 유지됩니다. 편집 중인 내용과 임시 글은 먼저 작성 이력에 저장하세요.</p><form action={action}><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="sourceRevision" value={sourceRevision}/><button disabled={pending||disabled} name="intent" value="restore" className={`${btn.primary} min-h-11`}>{pending?'복원 중…':'복원하여 새 버전 저장'}</button>{disabled&&<p className="mt-2 text-sm">보관함에서 꺼낸 뒤 복원할 수 있습니다.</p>}{state.error&&<p role="alert" className="mt-2 text-sm text-accent">{state.error}</p>}</form></details>;
}
