import { AppShell } from '@/components/app-shell';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="app">{children}</AppShell>;
}
