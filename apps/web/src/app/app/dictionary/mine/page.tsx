import Link from 'next/link';
import {personalDictionaryPage} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {PageHeader,btn,input,Empty} from '@/components/ui';
import {ManualPersonal} from '@/components/save-personal';
import {PersonalEntryEditor} from '@/components/personal-entry-editor';
import {LibraryPagination} from '@/components/library-pagination';
import {CopyButton} from '@/components/copy-button';
import {archivePersonalAction} from './actions';
export default async function Mine({searchParams}:{searchParams:Promise<{q?:string;folder?:string;favorite?:string;page?:string}>}) {
 const sp=await searchParams,q=(sp.q??'').slice(0,100),folder=(sp.folder??'').slice(0,60),favorite=sp.favorite??'';
 const result=await withPageCtx(ctx=>personalDictionaryPage(ctx,{q,folder,favorite:favorite==='1',page:Number(sp.page??1)}));
 const {items,folders}=result;const filters={q,folder,favorite};
 return <><PageHeader title="내 모음" description="본인만 볼 수 있는 태그·표현 모음입니다. 뜻·개인 메모·분류·사용법과 예문을 정리하세요." actions={<Link href="/app/dictionary" className={`${btn.secondary} min-h-11`}>해시태그·표현 찾기</Link>}/>
 <form className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-4"><label className="min-w-0 text-sm">내 사전 검색<input aria-label="내 사전 검색" name="q" defaultValue={q} maxLength={100} placeholder="표현·뜻·메모·사용법·예문" className={input}/></label><label>분류 필터<select name="folder" defaultValue={folder} className={input}><option value="">전체 분류</option>{folders.map(f=><option key={f}>{f}</option>)}</select></label><label><input type="checkbox" name="favorite" value="1" defaultChecked={favorite==='1'}/> 즐겨찾기만</label><div className="flex flex-wrap gap-2 sm:self-end"><button className={`${btn.secondary} min-h-11`}>검색</button>{(q||folder||favorite)&&<Link href="/app/dictionary/mine" className={`${btn.secondary} min-h-11`}>초기화</Link>}</div></form>
 <LibraryPagination label="내 사전 페이지" path="/app/dictionary/mine" {...result} params={filters}/>
 {!items.length&&<Empty title="표시할 항목이 없습니다">검색·분류를 바꾸거나 공용사전·탐색에서 저장해 보세요.</Empty>}
 <ul className="grid gap-3 sm:grid-cols-2">{items.map(e=><li key={e.id} className="min-w-0 break-words rounded-xl border border-line p-4"><h2 lang="zh-CN" className="py-2 font-semibold">{e.favorite?'★ ':''}{e.term}</h2><p>{e.meaning}</p>{e.usage&&<p className="mt-2 text-sm">사용법: {e.usage}</p>}{e.cautions.length>0&&<p className="mt-2 text-xs text-warn">{e.cautions.join(' · ')}</p>}
 <details className="my-2"><summary className="min-h-11 cursor-pointer py-2">예문·분류·관찰 정보</summary>{e.folder&&<p className="text-xs">분류: {e.folder}</p>}{e.note&&<p className="whitespace-pre-wrap text-sm">메모: {e.note}</p>}{e.examples.map((example,i)=><div key={i} className="my-1 text-sm"><p lang="zh-CN">{example.zh}</p><p>{example.ko}</p></div>)}<p className="text-xs text-muted">{e.unknownTrendNote}{e.revision>1?' · 개인 편집됨':''}</p></details><div className="my-2 flex flex-wrap gap-2"><CopyButton text={e.entryType==='tag'?'#'+e.term.replace(/^#+/,''):e.term} label="복사"/><Link href={'/app/discover?q='+encodeURIComponent(e.term.replace(/^#+/,''))} className={`${btn.secondary} min-h-11`}>관련 게시물 보기</Link></div><PersonalEntryEditor entry={e}/></li>)}</ul>
 {result.pages>1&&<LibraryPagination label="내 사전 하단 페이지" path="/app/dictionary/mine" {...result} params={filters}/>}
 <details className="mt-4"><summary>저장 항목 정리</summary>{items.map(e=><form key={e.id} action={archivePersonalAction} className="my-2"><input type="hidden" name="id" value={e.id}/><span>{e.term} </span><button className={btn.small}>내 목록에서 숨기기</button></form>)}<p className="text-xs">같은 항목을 다시 저장하면 복원됩니다. </p></details><ManualPersonal/></>;
}
