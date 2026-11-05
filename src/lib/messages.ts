import en from '../../messages/en.json';

/**
 * TEMPORARY accessor until T8 installs next-intl and replaces it.
 * Keys are dotted paths into messages/en.json.
 */
export function t(key: string): string {
  let cur: unknown = en;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return key;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : key;
}
