import Link from 'next/link';
import type { ReactNode } from 'react';

export function MockBanner({ mode }: { mode: string }) {
  if (mode !== 'mock') return null;
  return (
    <div role="note" className="bg-warn-soft text-warn text-xs px-4 py-1.5 text-center">
      데모 데이터 · 실제 샤오홍슈 데이터 아님 — 외부 API·AI 호출 없이 동작합니다
    </div>
  );
}

export function DemoBadge({ mode = 'mock' }: { mode?: string }) {
  if (mode !== 'mock') return null;
  return <span className="inline-flex items-center rounded-full bg-warn-soft text-warn px-2 py-0.5 text-[11px] font-medium">데모 데이터</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'info' }) {
  const t = {
    neutral: 'bg-bg text-muted border border-line',
    accent: 'bg-accent-soft text-accent',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    info: 'bg-info-soft text-info',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNotice({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return <div role="alert" className="mb-4 rounded-xl bg-accent-soft text-accent px-4 py-3 text-sm">{message}</div>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' }) {
  const t = { info: 'bg-info-soft text-info', warn: 'bg-warn-soft text-warn', ok: 'bg-ok-soft text-ok' }[tone];
  return <div role="status" className={`rounded-xl px-4 py-3 text-sm ${t}`}>{children}</div>;
}

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90 disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-1 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-bg',
  ghost: 'inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-bg hover:text-ink',
  small: 'inline-flex items-center justify-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-bg',
};
export const inputBase = 'rounded-xl border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70';
export const input = `w-full ${inputBase}`;
export const selectAuto = `w-auto ${inputBase}`;
export const label = 'block text-sm font-medium mb-1';

export function LinkButton({ href, children, variant = 'secondary' }: { href: string; children: ReactNode; variant?: keyof typeof btn }) {
  return <Link href={href} className={btn[variant]}>{children}</Link>;
}

/** Internal placeholder thumbnail: third-party media is never displayed without a license (spec F04). */
export function Thumb({ seed, type }: { seed: string; type: 'video' | 'image' | null }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div aria-hidden className="relative h-24 w-full overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, hsl(${h} 60% 85%), hsl(${(h + 40) % 360} 55% 70%))` }}>
      <span className="absolute left-2 top-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] text-white">{type === 'video' ? '▶ 영상' : type === 'image' ? '이미지' : '형식 미확인'}</span>
      <span className="absolute bottom-2 right-2 text-[10px] text-black/50">내부 생성 썸네일</span>
    </div>
  );
}
