'use client';
import {useActionState,useState,useEffect} from 'react';
import Link from 'next/link';
import type {WritingDraft,SharedDictionaryEntry,DictionaryAiResult,TemporaryWriting} from '@xhs/core';
import {saveWritingAction} from '@/app/app/write/actions';
import {btn,input} from './ui';
import {chineseReviewKey,restoreWithSelection} from './writing-completion';
import {CopyButton} from './copy-button';
import {useWritingRecovery} from './use-writing-recovery';
export function WritingEditor({entries,draft,suggestion}:{entries:SharedDictionaryEntry[];draft?:WritingDraft;suggestion?:DictionaryAiResult|undefined}) {
 const [id,setId]=useState(draft?.id??'');
 useEffect(()=>{if(!draft)setId(crypto.randomUUID());},[draft]);
 const [state,action,pending]=useActionState(saveWritingAction,{revision:draft?.revision??0});
 const [baseRevision,setBaseRevision]=useState(draft?.revision??0);
 const [title,setTitle]=useState(draft?.title??''),[cover,setCover]=useState(draft?.cover??'');
 const [body,setBody]=useState(draft?.body??''),[meaning,setMeaning]=useState(draft?.meaningKo??'');
 const [learningNotes,setLearningNotes]=useState(draft?.learningNotes??'');
 const [meaningReviewedFor,setMeaningReviewedFor]=useState(draft?.meaningReviewedFor??'');
 const [tagsEdited,setTagsEdited]=useState(false),[restoredIds,setRestoredIds]=useState<string[]|null>(null);
 const [tags,setTags]=useState(draft?.tags.join(' ')??entries.filter(e=>e.entryType==='tag').map(e=>e.term).join(' '));
 const revision=state.revision||baseRevision;
 useEffect(()=>{if(!draft&&!tagsEdited)setTags(entries.filter(e=>e.entryType==='tag').map(e=>e.term).join(' '));},[entries,draft,tagsEdited]);
 const entryIds=restoredIds??entries.map(e=>e.id);
 const content={id,revision,title,cover,body,meaningKo:meaning,meaningReviewedFor,learningNotes,tags:tags.split(/[\s,#，]+/).filter(Boolean),entryIds};
 function restore(raw:NonNullable<TemporaryWriting['content']>){
  const value=restoreWithSelection(raw,entries);setMeaningReviewedFor(value.meaningReviewedFor??'');setLearningNotes(value.learningNotes??'');
  setId(value.id);setBaseRevision(draft?.revision??value.revision);setTitle(value.title);setCover(value.cover);setBody(value.body);setMeaning(value.meaningKo);setTags(value.tags.join(' '));setTagsEdited(true);setRestoredIds(value.entryIds);
 }
 const recovery=useWritingRecovery(draft?`draft:${draft.id}`:'new',content,pending,restore,state);
 return <section data-writing-unsaved={recovery.unprotected?'true':'false'} className="mt-5 rounded-xl border border-line p-4"><h2 className="font-semibold">글쓰기·저장</h2><p className="my-2 text-xs text-muted">입력을 멈추면 본인 전용 공간에 자동 임시 저장합니다. 임시 저장은 30일 동안 복원할 수 있습니다. 작성 이력에 저장하면 버전으로 보관합니다.</p>
 <p role="status" className="my-2 text-sm">{recovery.status}</p>{recovery.error&&<p role="alert" className="text-accent">{recovery.error}</p>}
 {recovery.recovery?.content&&<div className="my-3 rounded border border-line p-3"><h3 className="font-semibold">작성하던 내용 복원</h3><p>{recovery.recovery.content.title||'제목 없는 글'} · {recovery.recovery.terms.join(' · ')}</p><p className="text-xs">저장 당시 버전 {recovery.recovery.content.revision}. 현재 저장본이 더 최신이면 내용을 비교한 뒤 저장하세요.</p><details><summary>임시 내용 미리보기</summary><p className="whitespace-pre-wrap">{recovery.recovery.content.body}</p></details><button type="button" className={btn.primary} onClick={()=>void recovery.resolve(true)}>임시 저장 복원</button> <button type="button" className={btn.secondary} onClick={()=>void recovery.resolve(false)}>임시 저장 지우고 새로 작성</button></div>}
 {suggestion&&<button type="button" disabled={!recovery.ready||pending} className={btn.secondary} onClick={()=>{setTitle(suggestion.titles[0]?.zh??'');setBody(suggestion.bodyZh);setMeaning(suggestion.bodyKo);setTags(suggestion.tags.join(' '));setTagsEdited(true);}}>AI 결과를 편집란에 적용 (현재 제목·본문·태그 교체)</button>}
 <form action={action} className="mt-3 space-y-3"><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="meaningReviewedFor" value={meaningReviewedFor}/>{entryIds.map(entryId=><input key={entryId} type="hidden" name="entryIds" value={entryId}/>)}
 <fieldset disabled={!recovery.ready||pending} className="space-y-3">
 <label className="block">개인 참고 메모 (검토 요청에 공유되지 않음)<textarea name="learningNotes" value={learningNotes} maxLength={12000} rows={3} onChange={e=>setLearningNotes(e.target.value)} className={input}/></label><label className="block">중국어 제목<input name="title" maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} className={input}/></label>
 <p className="text-xs text-muted" role="status">제목 {title.length}/200자 · 간결한 제목 권장 기준 20자{title.length>20?' — 게시 전 제목 길이를 확인하세요.':''}</p><label className="block">표지 문구<input name="cover" maxLength={100} value={cover} onChange={e=>setCover(e.target.value)} className={input}/></label>
 <label className="block">중국어 본문<textarea aria-label="중국어 본문" name="body" rows={8} maxLength={10000} value={body} onChange={e=>setBody(e.target.value)} className={input}/></label>
 {content.tags.length>20&&<p role="alert">태그가 20개를 넘었습니다. 추가한 내용은 유지되며, 저장 전에 태그를 줄여 주세요.</p>}<label className="block">한국어 확인본<textarea aria-label="한국어 확인본" name="meaningKo" rows={4} maxLength={10000} value={meaning} onChange={e=>setMeaning(e.target.value)} className={input}/></label>
 <label className="block">해시태그 (공백으로 구분)<input name="tags" value={tags} onChange={e=>{setTags(e.target.value);setTagsEdited(true);}} className={input}/></label>
 {meaning&&<div className="rounded-lg border border-line p-3"><p role="status" className="text-sm">{meaningReviewedFor===chineseReviewKey(content)?'현재 중국어와 한국어 확인본을 대조했습니다.':'중국어 원문과 한국어 확인본을 다시 대조해 주세요. 중국어를 수정해도 확인본은 자동 번역되지 않습니다.'}</p><button type="button" className={`${btn.secondary} mt-2 min-h-11`} onClick={()=>setMeaningReviewedFor(chineseReviewKey(content))}>한국어 확인본 검토 완료</button></div>}
 <button disabled={pending||!id||recovery.busy} className={btn.primary}>{pending?'저장 중…':'작성 이력에 저장'}</button></fieldset>
 {restoredIds&&<p className="text-xs">복원한 사전 항목 {restoredIds.length}개를 함께 보관합니다. <button type="button" className="underline" onClick={()=>setRestoredIds([])}>복원한 사전 항목 제외</button></p>}
 {state.id&&<p role="status">버전 {state.revision} 저장 완료 · <Link className="inline-flex min-h-11 items-center underline" href={`/app/write/history/${state.id}`}>저장본·이력 열기</Link></p>}{state.error&&<p role="alert">{state.error}</p>}
 </form><section aria-label="게시물 미리보기" className="mt-5 space-y-3 rounded-xl border border-line bg-surface p-4"><h3 className="font-semibold">게시물 미리보기</h3><div className="flex aspect-[3/2] items-center justify-center rounded-xl bg-accent-soft p-5 text-center text-xl font-bold" lang="zh-CN">{cover||'표지 문구를 입력하세요'}</div><h4 lang="zh-CN" className="break-words text-lg font-semibold">{title||'제목 미입력'}</h4><div className="grid gap-3 md:grid-cols-2"><div><p className="text-xs text-muted">중국어 원문</p><p lang="zh-CN" className="whitespace-pre-wrap break-words">{body||'본문 미입력'}</p></div><div><p className="text-xs text-muted">한국어 확인본</p><p className="whitespace-pre-wrap break-words">{meaning||'한국어 확인본 미입력'}</p></div></div><p lang="zh-CN" className="break-words text-accent">{content.tags.map(t=>'#'+t).join(' ')}</p><div className="flex flex-wrap gap-2"><CopyButton text={title} label="제목만 복사"/><CopyButton text={body} label="본문만 복사"/><CopyButton text={content.tags.map(t=>'#'+t).join(' ')} label="태그만 복사"/></div></section><div className="mt-3"><CopyButton text={[title,body,tags.split(/[\s,#，]+/).filter(Boolean).map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n')} label="현재 제목·본문·태그 복사"/></div></section>;
}
