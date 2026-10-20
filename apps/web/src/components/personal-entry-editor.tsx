'use client';
import {useActionState,useState} from 'react';
import type {PersonalDictionaryEntry} from '@xhs/core';
import {editPersonalAction} from '@/app/app/dictionary/mine/actions';
import {btn,input} from './ui';
export function PersonalEntryEditor({entry}:{entry:PersonalDictionaryEntry}){
 const [state,action,pending]=useActionState(editPersonalAction,{revision:entry.revision});
 const [examples,setExamples]=useState(()=>entry.examples.length?entry.examples:[{zh:'',ko:''}]);
 return <details className="mt-3"><summary>뜻·분류·예문 수정</summary><form action={action} className="mt-3 space-y-3" aria-label={`${entry.term} 편집`}>
 <input type="hidden" name="id" value={entry.id}/><input type="hidden" name="revision" value={state.revision??entry.revision}/>
 <label className="block">뜻<textarea aria-label="뜻" name="meaning" defaultValue={entry.meaning} maxLength={1000} className={input}/></label>
 <label className="block">개인 메모<textarea aria-label="개인 메모" name="note" defaultValue={entry.note} maxLength={2000} className={input}/></label>
 <label className="block">분류<input name="folder" defaultValue={entry.folder} maxLength={60} placeholder="예: 뷰티 · 여행 · 제목 표현" className={input}/></label>
 <label className="block"><input type="checkbox" name="favorite" defaultChecked={entry.favorite}/> 즐겨찾기</label>
 <label className="block">사용법·사용 상황<textarea aria-label="사용법·사용 상황" name="usage" defaultValue={entry.usage} maxLength={2000} className={input}/></label>
 <p className="text-xs text-muted">직접 편집한 뜻·사용법과 학습용 예문입니다. 실제 게시물 사용이나 인기의 근거로 간주하지 않습니다.</p>
 {examples.map((example,index)=><fieldset key={index} className="rounded border border-line p-2"><legend>예문 {index+1}</legend><label className="block">중국어 예문<input aria-label={`중국어 예문 ${index+1}`} name="exampleZh" value={example.zh} maxLength={1000} onChange={e=>setExamples(current=>current.map((v,i)=>i===index?{...v,zh:e.target.value}:v))} className={input}/></label><label className="block">한국어 뜻<input aria-label={`한국어 뜻 ${index+1}`} name="exampleKo" value={example.ko} maxLength={1000} onChange={e=>setExamples(current=>current.map((v,i)=>i===index?{...v,ko:e.target.value}:v))} className={input}/></label><button type="button" className={btn.small} onClick={()=>setExamples(current=>current.filter((_,i)=>i!==index))}>예문 {index+1} 제거</button></fieldset>)}
 {examples.length<10&&<button type="button" className={btn.secondary} onClick={()=>setExamples(current=>[...current,{zh:'',ko:''}])}>예문 추가</button>} <button disabled={pending} className={btn.primary}>{pending?'저장 중…':'사전 변경 저장'}</button>
 {state.success&&<p role="status">사전 변경 저장 완료</p>}{state.error&&<p role="alert">{state.error}</p>}
 </form></details>;
}
