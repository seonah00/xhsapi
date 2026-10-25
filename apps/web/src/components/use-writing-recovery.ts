'use client';
import {useEffect,useRef,useState} from 'react';
import type {TemporaryWriting} from '@xhs/core';
import {loadTemporaryAction,storeTemporaryAction} from '@/app/app/write/actions';
type Content=NonNullable<TemporaryWriting['content']>;
export function useWritingRecovery(scope:string,content:Content,manualPending:boolean,onRestore:(content:Content)=>void,saved:{id?:string;revision?:number}){
 const [ready,setReady]=useState(false),[recovery,setRecovery]=useState<TemporaryWriting|null>(null);
 const [status,setStatus]=useState('임시 저장 확인 중…'),[error,setError]=useState(''),[tick,setTick]=useState(0);
 const version=useRef(0),synced=useRef(''),busy=useRef(false),blocked=useRef(false),restoreCallback=useRef(onRestore);
 restoreCallback.current=onRestore;
 const serialized=JSON.stringify(content);
 const latest=useRef(serialized);latest.current=serialized;
 useEffect(()=>{
  let active=true;setReady(false);setError('');blocked.current=false;
  loadTemporaryAction(scope).then(result=>{
   if(!active)return;version.current=result.version;synced.current=latest.current;
   if(result.content){setRecovery(result);setStatus('이전에 작성하던 임시 저장이 있습니다.');}
   else{setReady(true);setStatus('내용을 입력하면 자동으로 임시 저장합니다.');}
  }).catch(()=>{if(active){setError('임시 저장을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.');setStatus('임시 저장 확인 실패');}});
  return()=>{active=false;};
 },[scope]);
 // Explicit saving takes precedence; clear only the working-copy version this editor owns.
 useEffect(()=>{
  if(!saved.id||!saved.revision)return;
  setReady(false);busy.current=true;
  storeTemporaryAction({scope,version:version.current,content:null}).then(result=>{
   if(result.error){setError(result.error);blocked.current=true;}
   else{version.current=result.version!;synced.current=latest.current;setStatus('작성 이력에 저장됨');}
  }).catch(()=>{setError('작성 이력은 저장됐지만 임시 저장 정리를 완료하지 못했습니다.');blocked.current=true;})
   .finally(()=>{busy.current=false;setReady(true);setTick(t=>t+1);});
 },[saved.id,saved.revision,scope]);
 useEffect(()=>{
  if(version.current===0&&!content.title&&!content.cover&&!content.body&&!content.meaningKo&&!content.learningNotes)return;
  if(!ready||manualPending||busy.current||blocked.current||!content.id||serialized===synced.current)return;
  setStatus('임시 저장 대기 중…');
  const timer=setTimeout(()=>{
   busy.current=true;setStatus('임시 저장 중…');
   storeTemporaryAction({scope,version:version.current,content:JSON.parse(serialized)}).then(result=>{
    if(result.error){blocked.current=true;setError(result.error);setStatus('임시 저장 중지됨');}
    else{version.current=result.version!;synced.current=serialized;setError('');setStatus('자동 임시 저장 완료');}
   }).catch(()=>{blocked.current=true;setError('임시 저장에 실패했습니다. 내용을 복사하거나 작성 이력에 저장해 주세요.');setStatus('임시 저장 실패');})
    .finally(()=>{busy.current=false;setTick(t=>t+1);});
  },900);
  return()=>clearTimeout(timer);
 },[ready,manualPending,scope,serialized,content.id,tick]);
 const unprotected=ready&&serialized!==synced.current;
 useEffect(()=>{
  if(!unprotected)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  const click=(event:MouseEvent)=>{
   const link=(event.target as Element)?.closest('a[href]');
   if(link instanceof HTMLAnchorElement&&link.target!=='_blank'&&link.href!==location.href&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){
    if(!window.confirm('아직 임시 저장되지 않은 내용이 있습니다. 이 화면을 떠날까요?'))event.preventDefault();
   }
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);
  return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true);};
 },[unprotected]);
 async function resolve(restore:boolean){
  if(!recovery?.content)return;
  if(restore){restoreCallback.current(recovery.content);synced.current=JSON.stringify(recovery.content);setStatus('임시 저장을 복원했습니다.');setRecovery(null);setReady(true);}
  else{
   setStatus('임시 저장 정리 중…');
   try{const result=await storeTemporaryAction({scope,version:version.current,content:null});
    if(result.error){setError(result.error);return;}
    version.current=result.version!;synced.current=latest.current;setRecovery(null);setReady(true);setStatus('새로 작성할 수 있습니다.');
   }catch{setError('임시 저장 정리에 실패했습니다. 새로고침 후 다시 확인하세요.');}
  }
 }
 return {ready,recovery,status,error,resolve,unprotected,busy:status==='임시 저장 중…'||!ready};
}
