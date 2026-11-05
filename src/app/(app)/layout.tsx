import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getCurrentUser } from '@/lib/auth/current-user';

export const dynamic = 'force-dynamic';

// Authoritative session check for every shell page (the proxy only checks cookie presence).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <AppShell user={user}>{children}</AppShell>;
}
