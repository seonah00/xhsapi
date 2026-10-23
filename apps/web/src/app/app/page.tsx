import Link from 'next/link';
import { PageHeader, Card, btn } from '@/components/ui';
export const metadata = { title: '홈' };
export default function Home() {
  return <div className="mobile-dashboard"><PageHeader title="샤오홍슈 표현 찾기" description="공용사전과 실제 게시물에서 해시태그·중국어 표현을 찾고 작성에 활용하세요."/>
    <div className="grid gap-4 sm:grid-cols-2">
      <Card><h2 className="text-lg font-semibold">공용사전</h2><p className="my-3">등록한 태그와 표현의 뜻을 확인하고 중국어 제목·본문 초안을 작성하세요.</p><Link href="/app/dictionary" className={btn.primary}>사전 열기</Link></Card>
      <Card><h2 className="text-lg font-semibold">탐색</h2><p className="my-3">한국어 주제로 게시물을 찾고 실제 쓰인 해시태그·표현과 원문을 확인하세요.</p><Link href="/app/discover" className={btn.primary}>게시물 탐색</Link></Card>
    </div></div>;
}
