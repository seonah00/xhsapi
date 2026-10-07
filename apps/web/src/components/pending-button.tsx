'use client';
import { useFormStatus } from 'react-dom';

/** Submit button that shows progress and blocks double submits while the server action runs. */
export function PendingButton({ className, children, pendingText = '처리 중…' }: { className: string; children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}
