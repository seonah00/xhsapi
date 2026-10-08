import { AppShell } from '@/components/app-shell';
import { withAdmin } from './forbidden-guard';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await withAdmin(async () => true);
  return <AppShell area="admin">{children}</AppShell>;
}
