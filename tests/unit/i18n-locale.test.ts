import { describe, expect, it } from 'vitest';
import { resolveLocale } from '@/i18n/locale';

describe('resolveLocale', () => {
  it('defaults to en with no session', () => {
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });
  it('uses the user locale when supported', () => {
    expect(resolveLocale({ locale: 'en' })).toBe('en');
  });
  it('falls back to en for unsupported or empty locales', () => {
    expect(resolveLocale({ locale: 'xx' })).toBe('en');
    expect(resolveLocale({ locale: '' })).toBe('en');
    expect(resolveLocale({ locale: null })).toBe('en');
  });
});
