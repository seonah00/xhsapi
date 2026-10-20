import Link from 'next/link';
import {getWriting} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {WritingEditor} from '@/components/writing-editor';
import {PageHeader,btn} from '@/components/ui';
import {fmtDate} from '@/components/labels';
export default async function SavedWriting({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;const {draft,versions}=await withPageCtx(ctx=>getWriting(ctx,id));
 return <><PageHeader title="저장한 글 수정" description="저장할 때마다 새 버전을 남깁니다. 다른 화면의 수정과 충돌하면 덮어쓰지 않습니다." actions={<Link href="/app/write/history" className={btn.secondary}>작성 이력</Link>}/><p>사용한 항목: {draft.entries.map(e=>e.term).join(' · ')||'없음'}</p><WritingEditor key={draft.id} entries={[]} draft={draft}/><h2 className="mt-6 font-semibold">이전 저장본 (최근 50개)</h2>{versions.map(v=><details key={v.revision} className="my-2 rounded-xl border border-line p-3"><summary>버전 {v.revision} · {fmtDate(v.created_at.toISOString(),true)}</summary><h3>{v.snapshot.title}</h3><p>표지: {v.snapshot.cover}</p><p className="whitespace-pre-wrap">{v.snapshot.body}</p><p className="whitespace-pre-wrap">{v.snapshot.meaningKo}</p><p>{v.snapshot.tags.join(' · ')}</p></details>)}</>;
}
