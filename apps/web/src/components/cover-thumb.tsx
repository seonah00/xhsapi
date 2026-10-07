'use client';
import { useState } from 'react';

/**
 * Provider cover loaded by the browser straight from the Xiaohongshu CDN (no referrer, never proxied or stored).
 * Signed cover URLs expire or may be refused; then the internal placeholder is shown instead.
 */
export function CoverThumb({ src, alt, fallback }: { src: string; alt: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(true)}
      className="h-40 w-full rounded-xl bg-bg object-cover" />
  );
}
