import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

/** `generateMetadata` result for a page whose title is one catalog string (WCAG 2.4.2). */
export async function titleFromCatalog(key: string): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(key) };
}

/**
 * Title of the shared 404. The root layout's template does not apply to its own segment, so the
 * full title is built here. Fixed text only: every invalid-link branch must stay identical (R4).
 * A page that can call `notFound()` must return this from its own `generateMetadata` in that
 * case too: the browser applies the page's metadata over the 404's, so otherwise an invalid
 * invite link would be titled "Create your account" and tell a prober the token was real.
 */
export async function notFoundMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: { absolute: `${t('meta.notFound')} · ${t('common.home')}` } };
}
