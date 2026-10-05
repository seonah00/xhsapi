'use client';
import { useState } from 'react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs">{done ? '복사됨' : label}</button>
  );
}
