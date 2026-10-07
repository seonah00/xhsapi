'use client';
import { useState } from 'react';
import { useCoverFailure } from './cover-repair';

/**
 * Provider cover loaded by the browser straight from the Xiaohongshu CDN (no referrer, never proxied or stored).
 * Signed cover URLs expire or may be refused; then the internal placeholder is shown instead.
 */
export function CoverThumb({ src, alt, fallback, noteId }: { noteId?: string; src: string; alt: string; fallback: React.ReactNode }) {
  const report = useCoverFailure();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === src;
  if (failed) return <div className="relative">{fallback}<span className="absolute bottom-2 left-2 rounded bg-black/45 px-1 text-[10px] text-white">표지를 불러오지 못함</span></div>;
  return (
    <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => { setFailedSource(src); if (noteId) report?.(noteId, src); }}
      className="h-40 w-full rounded-xl bg-bg object-cover" />
  );
}
