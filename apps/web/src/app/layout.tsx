import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'XHS 콘텐츠 스튜디오', template: '%s · XHS 콘텐츠 스튜디오' },
  description: '샤오홍슈 콘텐츠 탐색·기획·중국어 표현 학습 도구',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh bg-bg text-ink">{children}</body>
    </html>
  );
}
