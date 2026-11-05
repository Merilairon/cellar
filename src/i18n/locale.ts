export const SUPPORTED_LOCALES = ['en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

function isSupported(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** user.locale for a signed-in user, else the default; unsupported values fall back to en. */
export function resolveLocale(user?: { locale?: string | null } | null): Locale {
  return isSupported(user?.locale) ? user.locale : DEFAULT_LOCALE;
}
