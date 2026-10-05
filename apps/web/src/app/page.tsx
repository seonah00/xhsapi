import { redirect } from 'next/navigation';
import { readSession } from '@/server/session';

export default async function Root() {
  const s = await readSession();
  redirect(s ? '/app' : '/login');
}
