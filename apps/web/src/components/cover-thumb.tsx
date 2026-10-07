'use client';
import { useCallback, useState } from 'react';
import { useCoverFailure } from './cover-repair';

/**
 * Provider cover loaded by the browser straight from the Xiaohongshu CDN (no referrer, never proxied or stored).
 * Signed cover URLs expire or may be refused; then the internal placeholder is shown instead.
 */
export function CoverThumb({ src, alternateSrc, alt, fallback, noteId }: { noteId?: string; src: string; alternateSrc?: string | null | undefined; alt: string; fallback: React.ReactNode }) {
  const report = useCoverFailure();
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const candidates = [...new Set([src, alternateSrc].filter((value): value is string => !!value))];
  const current = candidates.find(value=>!failedSources.includes(value));
  const failed = !current;
  const onFailure = useCallback(() => {
    if (!current) return;
    setFailedSources(previous=>previous.includes(current) ? previous : [...previous,current]);
    if (noteId && (!alternateSrc || alternateSrc === src || current === alternateSrc)) report?.(noteId, src);
  }, [current, alternateSrc, src, noteId, report]);
  // A cached/CSP/network failure can happen before React attaches onError during hydration.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) onFailure();
  }, [onFailure]);
  if (failed) return <div className="relative">{fallback}<span className="absolute bottom-2 left-2 rounded bg-black/45 px-1 text-[10px] text-white">표지를 불러오지 못함</span></div>;
  return (
    <img key={current} ref={imageRef} src={current} alt={alt} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={onFailure}
      className="h-40 w-full rounded-xl bg-bg object-cover" />
  );
}
