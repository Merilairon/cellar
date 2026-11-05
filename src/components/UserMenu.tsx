'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function UserMenu({ name }: { name: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const isOpen = open === pathname;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`${t('nav.userMenu')}: ${name}`}
        onClick={() => setOpen(isOpen ? null : pathname)}
        className="flex h-10 max-w-40 items-center rounded px-3 hover:bg-neutral-200 dark:hover:bg-neutral-800"
      >
        <span className="truncate">{name}</span>
      </button>
      {isOpen && (
        <div className="absolute right-0 z-10 mt-1 flex w-44 flex-col rounded border border-neutral-200 bg-white p-1 shadow dark:border-neutral-800 dark:bg-neutral-950">
          <Link
            href="/profile"
            className="rounded px-3 py-2 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            {t('nav.profile')}
          </Link>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full rounded px-3 py-2 text-left hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              {t('common.logout')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
