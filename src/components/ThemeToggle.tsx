'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { nextTheme, THEME_COOKIE, type Theme } from '@/lib/theme/theme';

const KEY: Record<Theme, string> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};
const ICON: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' };

export function ThemeToggle({ initial }: { initial: Theme }) {
  const t = useTranslations();
  const [theme, setTheme] = useState<Theme>(initial);

  function cycle() {
    const next = nextTheme(theme);
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${t('theme.label')}: ${t(KEY[theme])}`}
      title={t(KEY[theme])}
      className="h-10 w-10 rounded text-lg hover:bg-neutral-200 dark:hover:bg-neutral-800"
    >
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
