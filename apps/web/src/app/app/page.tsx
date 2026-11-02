import Link from 'next/link';
import { searchAutomatically } from './discover/actions';

export const metadata = { title: '홈' };

const topics = [
  ['beauty', '뷰티'], ['fashion', '패션'], ['food-places', '맛집·카페'],
  ['daily-life', '일상'], ['travel-outing', '여행'], ['parenting', '육아'],
] as const;

const collections = [
  { href: '/app/dictionary?entryType=tag', symbol: '#', title: '해시태그', description: '주제에 맞는 태그를 뜻과 함께 찾아보세요.', action: '해시태그 찾기', example: '#穿搭 · #日常生活', tone: 'bg-accent-soft text-accent' },
  { href: '/app/dictionary?entryType=expression', symbol: '文', title: '중국어 표현', description: '자연스러운 표현을 사용법·예문과 함께 익혀보세요.', action: '표현 찾기', example: '뜻부터 사용 상황까지', tone: 'bg-info-soft text-info' },
] as const;

export default function Home() {
  return (
    <div className="space-y-8 pb-6 sm:space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 sm:p-10" aria-labelledby="home-heading">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-accent-soft/50 blur-3xl" />
        <div className="relative max-w-3xl">
          <p className="mb-4 text-xs font-semibold tracking-[0.18em] text-accent">XHS LIBRARY</p>
          <h1 id="home-heading" className="text-2xl font-bold leading-snug tracking-tight sm:text-4xl">게시물과 중국어 표현 모음</h1>
          <p className="mt-3 text-sm leading-7 text-muted sm:text-base">눈길을 끄는 게시물부터 자연스러운 표현까지.<br className="hidden sm:block" /> 필요한 자료를 찾고, 나만의 모음으로 남겨보세요.</p>
          <form action={searchAutomatically} role="search" aria-label="게시물 검색" className="mt-7 flex flex-col gap-2 rounded-2xl border border-line bg-bg p-2 sm:flex-row">
            <label className="sr-only" htmlFor="home-query">게시물 검색어</label>
            <input id="home-query" name="q" required maxLength={100} placeholder="어떤 게시물을 찾으세요? 예: 뷰티, 穿搭" className="min-h-12 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-base placeholder:text-muted" />
            <button className="min-h-12 shrink-0 rounded-xl bg-accent px-6 font-semibold text-on-accent hover:opacity-90">게시물 검색 <span aria-hidden="true" className="ml-2">→</span></button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="주제별 게시물">
            <span className="mr-1 text-xs text-muted">주제로 찾기</span>
            {topics.map(([id, label]) => <Link key={id} href={`/app/discover?topic=${id}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm hover:border-accent hover:text-accent">{label}</Link>)}
          </div>
          <Link href="/app/discover" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-accent">게시물 탐색 <span aria-hidden="true" className="ml-2">↗</span></Link>
        </div>
      </section>

      <section aria-labelledby="library-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="library-heading" className="text-xl font-bold tracking-tight">필요한 말, 쉽게 찾기</h2>
          <p className="text-sm text-muted">확인하고 · 복사하고 · 저장하세요</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map(item => <Link key={item.href} href={item.href} aria-label={item.action} className="group flex flex-col rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-accent sm:p-7">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl font-medium ${item.tone}`}>{item.symbol}</span>
              <span aria-hidden="true" className="text-xl text-muted group-hover:text-accent">↗</span>
            </div>
            <h3 className="mt-5 text-xl font-bold">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{item.description}</p>
            <p className="mt-5 border-t border-line pt-4 text-sm text-muted">{item.example}</p>
            <span className="mt-4 font-semibold text-accent">{item.action} <span aria-hidden="true">→</span></span>
          </Link>)}
        </div>
      </section>

      <Link href="/app/dictionary/mine" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-6 py-5 hover:border-accent">
        <div><h2 className="font-bold">내 모음</h2><p className="mt-1 text-sm leading-6 text-muted">저장해 둔 해시태그와 표현을 다시 만나보세요.</p></div>
        <span className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">내 모음 열기 <span aria-hidden="true" className="ml-2">→</span></span>
      </Link>
    </div>
  );
}
