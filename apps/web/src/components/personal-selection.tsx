'use client';
import {useState,type ReactNode} from 'react';
import {btn} from './ui';
export function PersonalSelection({children}:{children:ReactNode}){
 const [selection,setSelection]=useState<Record<string,string>>({}),[message,setMessage]=useState('');
 const count=Object.keys(selection).length;
 return <div onChangeCapture={event=>{
  const target=event.target;if(!(target instanceof HTMLInputElement)||target.name!=='ids')return;
  const next={...selection};if(target.checked)next[target.value]=target.dataset.type??'tag';else delete next[target.value];
  if(Object.values(next).filter(type=>type==='tag').length>8||Object.values(next).filter(type=>type==='expression').length>3){target.checked=false;setMessage('태그 8개·표현 3개까지 선택할 수 있습니다.');return;}
  setSelection(next);setMessage('');
 }}><form id="select-personal-writing" action="/app/write" className="my-4 rounded-xl border border-line bg-surface p-3"><p className="mb-2 text-sm">현재 페이지에서 태그 8개·표현 3개까지 선택할 수 있습니다. 페이지를 바꾸면 선택이 초기화됩니다.</p><button disabled={!count} className={`${btn.primary} min-h-11`}>선택한 {count}개로 바로 글쓰기</button><p role="status" className="mt-2 text-sm">{message||`${count}개 선택됨`}</p></form>{children}</div>;
}
