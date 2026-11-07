import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { User } from '@/lib/db/users';
import { navItems } from '@/lib/nav';
import type { Theme } from '@/lib/theme/theme';
import { Suspense } from 'react';
import { SearchBox } from './search/SearchBox';
import { NavLinks } from './NavLinks';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

export async function Header({ user, theme }: { user: User; theme: Theme }) {
  const t = await getTranslations();
  return (
    <header className="relative border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
        <Link href="/" className="font-bold text-emerald-700 dark:text-emerald-400">
          {t('common.home')}
        </Link>
        <NavLinks items={navItems(user.role)} />
        <Suspense fallback={null}>
          <SearchBox />
        </Suspense>
        <ThemeToggle initial={theme} />
        <UserMenu name={user.displayName} />
      </div>
    </header>
  );
}
