import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { listUsersForAdmin } from '@/lib/auth/admin';
import { requireAdmin } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db';
import { DeactivateButton, InviteForm, ResetButton } from './forms';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const t = await getTranslations();
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.status === 401 ? '/login' : '/');
  const users = listUsersForAdmin(getDb());
  return (
    <main>
      <h1 className="mb-6 text-2xl font-bold">{t('admin.users.title')}</h1>
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">{t('admin.users.inviteHeading')}</h2>
        <InviteForm />
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('admin.users.listHeading')}</h2>
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>{t('admin.users.colEmail')}</th>
              <th>{t('admin.users.colName')}</th>
              <th>{t('admin.users.colRole')}</th>
              <th>{t('admin.users.colStatus')}</th>
              <th>{t('admin.users.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="align-top">
                <td>{u.email}</td>
                <td>{u.displayName}</td>
                <td>
                  {t(u.role === 'admin' ? 'admin.users.roleAdmin' : 'admin.users.roleMember')}
                </td>
                <td>
                  {t(u.active ? 'admin.users.statusActive' : 'admin.users.statusDeactivated')}
                </td>
                <td className="flex flex-col gap-1">
                  {u.active && (
                    <>
                      <ResetButton userId={u.id} />
                      <DeactivateButton userId={u.id} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
