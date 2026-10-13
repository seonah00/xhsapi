'use client';
import { useFormStatus } from 'react-dom';

/** Submit button that shows progress and blocks double submits while the server action runs. */
export function PendingButton({ className, children, pendingText = '처리 중…', disabled = false, formAction }: { className: string; children: React.ReactNode; pendingText?: string; disabled?: boolean; formAction?: (data: FormData) => Promise<void> }) {
  const { pending } = useFormStatus();
  return <button formAction={formAction} className={className} disabled={disabled || pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}
