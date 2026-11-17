import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ExportPanel } from '@/components/backup/ExportPanel';
import { RestorePanel } from '@/components/backup/RestorePanel';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getEnv } from '@/lib/env';

export default async function BackupPage() {
  const t = await getTranslations();
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const maxBytes = getEnv().RESTORE_BODY_MAX;
  return (
    <main className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">{t('backup.title')}</h1>
      <ExportPanel role={user.role} />
      <RestorePanel role={user.role} maxBytes={maxBytes} />
    </main>
  );
}
