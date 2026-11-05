'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { NavItem } from '@/lib/nav';

/** Inline links from md up; below that a button toggles a panel. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const isOpen = open === pathname; // closes itself on navigation

  const link = (i: NavItem) => (
    <Link
      key={i.href}
      href={i.href}
      aria-current={pathname.startsWith(i.href) ? 'page' : undefined}
      className="block rounded px-3 py-2 hover:bg-neutral-200 aria-[current=page]:font-semibold dark:hover:bg-neutral-800"
    >
      {t(i.labelKey)}
    </Link>
  );

  return (
    <nav aria-label={t('nav.main')} className="flex-1">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="main-nav-panel"
        onClick={() => setOpen(isOpen ? null : pathname)}
        className="h-10 rounded px-3 hover:bg-neutral-200 md:hidden dark:hover:bg-neutral-800"
      >
        {t('nav.menu')}
      </button>
      <div
        id="main-nav-panel"
        className={`${isOpen ? 'flex' : 'hidden'} absolute inset-x-0 top-full flex-col border-b border-neutral-200 bg-white p-2 md:static md:flex md:flex-row md:border-0 md:bg-transparent md:p-0 dark:border-neutral-800 dark:bg-neutral-950`}
      >
        {items.map(link)}
      </div>
    </nav>
  );
}
