import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { parseTheme, THEME_COOKIE } from '@/lib/theme/theme';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('common.home') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Theme comes from a cookie read on the server, so the first paint is already correct
  // (no inline script, CSP-friendly). No cookie means "system" via prefers-color-scheme.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme === 'system' ? undefined : theme}>
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
