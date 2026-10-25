import {learningHome} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {fmtDate} from '@/components/labels';
import Link from 'next/link';
import { PageHeader, Card, btn } from '@/components/ui';
export const metadata = { title: '홈' };
export default async function Home() {
  const work=await withPageCtx(learningHome);
  return <div className="mobile-dashboard"><PageHeader title="샤오홍슈 표현 찾기" description="공용사전과 실제 게시물에서 해시태그·중국어 표현을 찾고 작성에 활용하세요."/>
    <section aria-label="작업 이어가기" className="mb-5 space-y-3 rounded-xl border border-line bg-surface p-4"><h2 className="font-semibold">작업 이어가기</h2><div className="flex flex-wrap gap-2">{work.working?<Link className={`${btn.primary} min-h-11`} href={work.working.href}>이어서 작성 · {work.working.title||'임시 저장한 글'}</Link>:work.recent[0]?<Link className={`${btn.primary} min-h-11`} href={`/app/write/history/${work.recent[0].id}`}>이어서 작성</Link>:null}<Link href="/app/write" className={`${btn.secondary} min-h-11`}>새 글쓰기</Link><Link href="/app/dictionary/mine" className={`${btn.secondary} min-h-11`}>내 사전</Link></div>{work.recent.length?<ul className="divide-y divide-line">{work.recent.map(row=><li key={row.id} className="py-2"><Link className="inline-flex min-h-11 items-center text-accent underline" href={`/app/write/history/${row.id}`}>{row.title||'제목 없는 글'}</Link><p className="text-xs text-muted">버전 {row.revision} · {fmtDate(row.updated_at.toISOString(),true)}</p></li>)}</ul>:<p className="text-sm text-muted">저장한 글이 생기면 여기서 바로 이어서 작성할 수 있습니다.</p>}{work.terms.length>0&&<div><h3 className="text-sm font-medium">최근 작성에 사용한 태그·표현</h3><div className="mt-2 flex flex-wrap gap-2">{work.terms.map(term=><Link key={term} className={`${btn.small} min-h-11`} href={`/app/dictionary/mine?q=${encodeURIComponent(term)}`}>{term}</Link>)}</div></div>}</section><div className="grid gap-4 sm:grid-cols-2">
      <Card><h2 className="text-lg font-semibold">공용사전</h2><p className="my-3">등록한 태그와 표현의 뜻을 확인하고 중국어 제목·본문 초안을 작성하세요.</p><Link href="/app/dictionary" className={btn.primary}>사전 열기</Link></Card>
      <Card><h2 className="text-lg font-semibold">탐색</h2><p className="my-3">한국어 주제로 게시물을 찾고 실제 쓰인 해시태그·표현과 원문을 확인하세요.</p><Link href="/app/discover" className={btn.primary}>게시물 탐색</Link></Card>
    </div></div>;
}
