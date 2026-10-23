import Link from 'next/link';
import { btn } from './ui';
import type { discoveryPageLinks } from './discovery-pagination';

export function DiscoveryPager({ links, position }: { links: ReturnType<typeof discoveryPageLinks>; position: '상단' | '하단' }) {
  return <nav aria-label={`게시물 페이지 ${position}`} className="my-3 flex items-center justify-between gap-2">
    {links.previous ? <Link className={`${btn.secondary} min-h-11`} href={links.previous}>이전</Link> : <span className="px-4 text-sm text-muted" aria-disabled="true">이전</span>}
    <span aria-current="page" className="text-sm font-medium">{links.page}페이지</span>
    {links.next ? <Link className={`${btn.secondary} min-h-11`} href={links.next}>다음</Link> : <span className="px-4 text-sm text-muted" aria-disabled="true">다음</span>}
  </nav>;
}
