import Link from 'next/link';
import {personalDictionaryEntries} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {PageHeader,btn,input,Empty} from '@/components/ui';
import {ManualPersonal} from '@/components/save-personal';
import {archivePersonalAction} from './actions';
export default async function Mine({searchParams}:{searchParams:Promise<{q?:string}>}) {
 const {q=''}=await searchParams;const items=await withPageCtx(ctx=>personalDictionaryEntries(ctx,undefined,q));
 return <><PageHeader title="내 사전" description="본인만 볼 수 있는 태그·표현 모음입니다. 저장 당시의 뜻과 주의사항이며 최신 인기 지표가 아닙니다." actions={<><Link href="/app/dictionary" className={btn.secondary}>공용사전</Link><Link href="/app/write/history" className={btn.secondary}>작성 이력</Link></>}/>
 <form className="flex gap-2"><input aria-label="내 사전 검색" name="q" defaultValue={q} maxLength={100} className={input}/><button className={btn.secondary}>검색</button></form>
 {!items.length&&<Empty title="저장한 항목이 없습니다">공용사전이나 탐색에서 저장하거나 직접 등록하세요.</Empty>}
 <form action="/app/write" className="mt-4"><ul className="grid gap-3 sm:grid-cols-2">{items.map(e=><li key={e.id} className="rounded-xl border border-line p-3"><label className="font-semibold"><input type="checkbox" name="ids" value={e.id} aria-label={`${e.term} 글쓰기 선택`}/> {e.term}</label><p>{e.meaning}</p><p className="text-xs text-muted">{e.unknownTrendNote}</p><p className="text-xs">{e.cautions.join(' · ')}</p><Link href={`/app/write?ids=${e.id}`} className="text-accent">이 항목으로 글쓰기</Link></li>)}</ul><p className="my-2 text-sm">태그 최대 8개·표현 최대 3개를 선택하세요. 검색 결과는 최근 200개까지 표시됩니다.</p><button className={btn.primary}>선택한 항목으로 바로 글쓰기</button></form>
 <details className="mt-4"><summary>저장 항목 정리</summary>{items.map(e=><form key={e.id} action={archivePersonalAction} className="my-2"><input type="hidden" name="id" value={e.id}/><span>{e.term} </span><button className={btn.small}>내 목록에서 숨기기</button></form>)}<p className="text-xs">같은 항목을 다시 저장하면 복원됩니다. 기존 작성물은 유지됩니다.</p></details><ManualPersonal/></>;
}
