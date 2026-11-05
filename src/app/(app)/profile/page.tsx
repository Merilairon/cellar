import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { ProfileForm } from './form';

export default async function ProfilePage() {
  const t = await getTranslations();
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">{t('profile.title')}</h1>
      <p className="mb-4">
        {t('profile.email')}: {user.email}
      </p>
      <ProfileForm unitPref={user.unitPref} />
    </main>
  );
}
