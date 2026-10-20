'use client';
import {useActionState,useState,useEffect} from 'react';
import Link from 'next/link';
import type {WritingDraft,SharedDictionaryEntry,DictionaryAiResult} from '@xhs/core';
import {saveWritingAction} from '@/app/app/write/actions';
import {btn,input} from './ui';
import {CopyButton} from './copy-button';
export function WritingEditor({entries,draft,suggestion}:{entries:SharedDictionaryEntry[];draft?:WritingDraft;suggestion?:DictionaryAiResult|undefined}) {
 const [id,setId]=useState(draft?.id??'');
 useEffect(()=>{if(!draft) setId(crypto.randomUUID());},[draft]);
 const [state,action,pending]=useActionState(saveWritingAction,{revision:draft?.revision??0});
 const [title,setTitle]=useState(draft?.title??'');const [cover,setCover]=useState(draft?.cover??'');
 const [body,setBody]=useState(draft?.body??'');const [meaning,setMeaning]=useState(draft?.meaningKo??'');
 const [tagsEdited,setTagsEdited]=useState(false);
 const [tags,setTags]=useState(draft?.tags.join(' ')??entries.filter(e=>e.entryType==='tag').map(e=>e.term).join(' '));
 useEffect(()=>{if(!draft&&!tagsEdited) setTags(entries.filter(e=>e.entryType==='tag').map(e=>e.term).join(' '));},[entries,draft,tagsEdited]);
 return <section className="mt-5 rounded-xl border border-line p-4"><h2 className="font-semibold">글쓰기·저장</h2><p className="my-2 text-xs text-muted">작성한 글을 저장하거나 복사할 수 있습니다. 본인에게만 저장되며 게시되지 않습니다. 한국어 확인본은 중국어를 수정하면 함께 확인하세요.</p>
 {suggestion&&<button type="button" className={btn.secondary} onClick={()=>{setTitle(suggestion.titles[0]?.zh??'');setBody(suggestion.bodyZh);setMeaning(suggestion.bodyKo);setTags(suggestion.tags.join(' '));setTagsEdited(true);}}>AI 결과를 편집란에 적용 (현재 제목·본문·태그 교체)</button>}
 <form action={action} className="mt-3 space-y-3"><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={state.revision??draft?.revision??0}/>{entries.map(e=><input key={e.id} type="hidden" name="entryIds" value={e.id}/>)}
 <label className="block">중국어 제목<input name="title" maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} className={input}/></label>
 <label className="block">표지 문구<input name="cover" maxLength={100} value={cover} onChange={e=>setCover(e.target.value)} className={input}/></label>
 <label className="block">중국어 본문<textarea aria-label="중국어 본문" name="body" rows={8} maxLength={10000} value={body} onChange={e=>setBody(e.target.value)} className={input}/></label>
 <label className="block">한국어 확인본<textarea aria-label="한국어 확인본" name="meaningKo" rows={4} maxLength={10000} value={meaning} onChange={e=>setMeaning(e.target.value)} className={input}/></label>
 <label className="block">해시태그 (공백으로 구분)<input name="tags" value={tags} onChange={e=>{setTags(e.target.value);setTagsEdited(true);}} className={input}/></label>
 <button disabled={pending||!id} className={btn.primary}>{pending?'저장 중…':'작성 이력에 저장'}</button>{state.id&&<p role="status">버전 {state.revision} 저장 완료 · <Link className="underline" href={`/app/write/history/${state.id}`}>저장본·이력 열기</Link></p>}{state.error&&<p role="alert">{state.error}</p>}
 </form><div className="mt-3"><CopyButton text={[title,body,tags.split(/[\s,#，]+/).filter(Boolean).map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n')} label="현재 제목·본문·태그 복사"/></div></section>;
}
