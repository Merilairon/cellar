import { cookies } from 'next/headers';
import type { User } from '@/lib/db/users';
import { parseTheme, THEME_COOKIE } from '@/lib/theme/theme';
import { Header } from './Header';

export async function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <Header user={user} theme={theme} />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">{children}</div>
    </>
  );
}
