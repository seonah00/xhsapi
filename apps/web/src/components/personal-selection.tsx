'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {btn} from './ui';
import {restoreSelection,toggleSelection,type SelectedEntry} from './personal-selection-state';
const SelectionContext=createContext<{selected:SelectedEntry[];toggle:(e:SelectedEntry,checked:boolean)=>void;ready:boolean}|null>(null);
export function PersonalChoice({entry}:{entry:SelectedEntry}){
 const state=useContext(SelectionContext);
 return <input disabled={!state?.ready} className="mr-2 h-5 w-5 align-middle" type="checkbox" checked={!!state?.selected.some(e=>e.id===entry.id)} onChange={e=>state?.toggle(entry,e.target.checked)} aria-label={`${entry.term} 글쓰기 선택`}/>;
}
export function PersonalSelection({children,scope}:{children:ReactNode;scope:string}){
 const [selected,setSelected]=useState<SelectedEntry[]>([]),[ready,setReady]=useState(false),[message,setMessage]=useState('');
 const key='xhs-personal-selection:'+scope;
 useEffect(()=>{try{setSelected(restoreSelection(sessionStorage.getItem(key),scope));}catch{setMessage('브라우저 저장소를 사용할 수 없어 이 화면에서만 선택을 유지합니다.');}setReady(true);},[key,scope]);
 function update(next:SelectedEntry[]){setSelected(next);try{sessionStorage.setItem(key,JSON.stringify({scope,items:next}));}catch{setMessage('브라우저 저장소를 사용할 수 없어 이 화면에서만 선택을 유지합니다.');}}
 function toggle(entry:SelectedEntry,checked:boolean){const next=toggleSelection(selected,entry,checked);if(next===selected){setMessage('태그 8개·표현 3개까지 선택할 수 있습니다.');return;}setMessage('');update(next);}
 return <SelectionContext.Provider value={{selected,toggle,ready}}><div className={selected.length?'pb-24 sm:pb-0':''}>
 <form id="select-personal-writing" action="/app/write" className="sticky top-28 z-10 my-4 rounded-xl border border-line bg-surface p-3 shadow-sm">
 <p className="mb-2 text-sm">검색·분류·페이지를 바꿔도 이 브라우저 탭에서 선택을 유지합니다. 태그 8개·표현 3개까지 선택하세요.</p>
 <div className="flex flex-wrap items-center gap-2"><button disabled={!ready||!selected.length} className={`${btn.primary} min-h-11`}>선택한 {selected.length}개로 바로 글쓰기</button><button type="button" disabled={!selected.length} onClick={()=>update([])} className={`${btn.secondary} min-h-11`}>선택 비우기</button></div>
 <ul aria-label="선택한 사전 항목" className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-auto">{selected.map(e=><li key={e.id}><input type="hidden" name="ids" value={e.id}/><button type="button" onClick={()=>toggle(e,false)} aria-label={`${e.term} 선택 해제`} className={`${btn.small} min-h-11`}>{e.term} ×</button></li>)}</ul><p role="status" className="mt-2 text-sm">{message||`${selected.length}개 선택됨`}</p>
 </form>{children}{selected.length>0&&<div className="fixed inset-x-3 bottom-3 z-30 rounded-xl border border-line bg-surface p-2 shadow-lg sm:hidden"><button type="submit" form="select-personal-writing" className={`${btn.primary} min-h-11 w-full`}>선택한 항목으로 글쓰기 ({selected.length}개)</button></div>}</div></SelectionContext.Provider>;
}
