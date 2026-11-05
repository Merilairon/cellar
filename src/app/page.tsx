import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { t } from '@/lib/messages';

export const dynamic = 'force-dynamic';

// Placeholder page; replaced by the app shell in later tasks.
export default async function Home() {
  // The proxy only checks cookie presence; this is the authoritative session check.
  if (!(await getCurrentUser())) redirect('/login');
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold text-emerald-600">{t('common.home')}</h1>
    </main>
  );
}
