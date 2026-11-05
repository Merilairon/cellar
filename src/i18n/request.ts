import { getRequestConfig } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { resolveLocale, type Locale } from './locale';

const catalogs: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('../../messages/en.json'),
};

export default getRequestConfig(async () => {
  const locale = resolveLocale(await getCurrentUser());
  return { locale, messages: (await catalogs[locale]()).default };
});
