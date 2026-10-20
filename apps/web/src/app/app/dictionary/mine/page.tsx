import Link from 'next/link';
import {personalDictionaryEntries} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {PageHeader,btn,input,Empty} from '@/components/ui';
import {ManualPersonal} from '@/components/save-personal';
import {PersonalEntryEditor} from '@/components/personal-entry-editor';
import {archivePersonalAction} from './actions';
export default async function Mine({searchParams}:{searchParams:Promise<{q?:string;folder?:string;favorite?:string}>}) {
 const {q='',folder='',favorite=''}=await searchParams;
 const all=await withPageCtx(ctx=>personalDictionaryEntries(ctx,undefined,q));
 const folders=[...new Set(all.map(e=>e.folder).filter(Boolean))].sort();
 const items=all.filter(e=>(!folder||e.folder===folder)&&(favorite!=='1'||e.favorite));
 return <><PageHeader title="내 사전" description="본인만 볼 수 있는 태그·표현 모음입니다. 뜻·개인 메모·분류·사용법과 예문을 정리하세요." actions={<><Link href="/app/dictionary" className={btn.secondary}>공용사전</Link><Link href="/app/write/history" className={btn.secondary}>작성 이력</Link></>}/>
 <form className="flex flex-wrap items-center gap-2"><input aria-label="내 사전 검색" name="q" defaultValue={q} maxLength={100} placeholder="표현·뜻·메모·사용법 검색" className={input}/><label>분류 필터<select name="folder" defaultValue={folder} className={input}><option value="">전체 분류</option>{folders.map(f=><option key={f}>{f}</option>)}</select></label><label><input type="checkbox" name="favorite" value="1" defaultChecked={favorite==='1'}/> 즐겨찾기만</label><button className={btn.secondary}>검색</button></form>
 {!items.length&&<Empty title="표시할 항목이 없습니다">검색·분류를 바꾸거나 공용사전·탐색에서 저장해 보세요.</Empty>}
 <form id="select-personal-writing" action="/app/write" className="my-4"><p className="my-2 text-sm">태그 최대 8개·표현 최대 3개를 선택하세요. 최근 200개에서 검색·분류합니다.</p><button className={btn.primary}>선택한 항목으로 바로 글쓰기</button></form>
 <ul className="grid gap-3 sm:grid-cols-2">{items.map(e=><li key={e.id} className="rounded-xl border border-line p-3"><label className="font-semibold"><input form="select-personal-writing" type="checkbox" name="ids" value={e.id} aria-label={`${e.term} 글쓰기 선택`}/> {e.favorite?'★ ':''}{e.term}</label><p>{e.meaning}</p>{e.folder&&<p className="text-xs">분류: {e.folder}</p>}{e.note&&<p className="whitespace-pre-wrap text-sm">메모: {e.note}</p>}{e.usage&&<p className="text-sm">사용법: {e.usage}</p>}{e.examples.map((example,i)=><div key={i} className="my-1 text-sm"><p lang="zh-CN">{example.zh}</p><p>{example.ko}</p></div>)}<p className="text-xs text-muted">{e.unknownTrendNote}{e.revision>1?' · 개인 편집됨':''}</p><p className="text-xs">{e.cautions.join(' · ')}</p><Link href={`/app/write?ids=${e.id}`} className="text-accent">이 항목으로 글쓰기</Link><PersonalEntryEditor entry={e}/></li>)}</ul>
 <details className="mt-4"><summary>저장 항목 정리</summary>{items.map(e=><form key={e.id} action={archivePersonalAction} className="my-2"><input type="hidden" name="id" value={e.id}/><span>{e.term} </span><button className={btn.small}>내 목록에서 숨기기</button></form>)}<p className="text-xs">같은 항목을 다시 저장하면 복원됩니다. 기존 작성물은 유지됩니다.</p></details><ManualPersonal/></>;
}
