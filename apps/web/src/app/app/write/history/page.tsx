import Link from 'next/link';
import {listWriting} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {PageHeader,Empty,btn} from '@/components/ui';
import {fmtDate} from '@/components/labels';
export default async function History() {
 const rows=await withPageCtx(listWriting);
 return <><PageHeader title="작성 이력" description="본인의 저장본만 표시합니다. 최근 작성물 100개까지 볼 수 있습니다." actions={<Link className={btn.primary} href="/app/write">새 글쓰기</Link>}/>{!rows.length&&<Empty title="저장한 글이 없습니다"/>}<ul className="space-y-3">{rows.map(r=><li key={r.id} className="rounded-xl border border-line p-3"><Link href={`/app/write/history/${r.id}`} className="font-semibold text-accent">{r.title||'제목 없는 글'}</Link><p>버전 {r.revision} · {fmtDate(r.updated_at.toISOString(),true)}</p></li>)}</ul></>;
}
