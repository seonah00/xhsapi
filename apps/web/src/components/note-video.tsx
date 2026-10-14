"use client";
import { useState } from 'react';

export function NoteVideo({src}: {src: string}) {
  const [started,setStarted]=useState(false);
  const [failed,setFailed]=useState(false);
  return <section id="video" className="my-4 space-y-2" aria-label="게시물 영상">
    <h2 className="font-semibold">게시물 영상</h2>
    {!started ? <button className="rounded border border-line px-4 py-2" onClick={()=>setStarted(true)}>영상 재생</button> :
      <video aria-label="게시물 영상 플레이어" className="max-h-[70vh] w-full rounded-xl bg-black" src={src} controls playsInline preload="metadata" onError={()=>setFailed(true)} />}
    {failed && <p role="alert">영상을 불러오지 못했습니다. 영상 주소가 만료되었거나 외부 재생이 제한될 수 있습니다.</p>}
    <p className="text-xs text-muted">재생을 누르면 샤오홍슈 영상 서버에 연결합니다. 원문 댓글·저장 기능은 포함하지 않습니다.</p>
  </section>;
}
