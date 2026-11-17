import { describe, expect, it } from 'vitest';
import { backupV1Schema } from '@/lib/backup/schema';
import { validDoc, validRecipe } from '@/lib/backup/schema-fixtures';
import { SAMPLE_SKILLET_COOKIES } from './samples';
import { recipeInputSchema } from './schemas';

// v1.0 security review L2: a stored `http://user:pw@host/` is rendered as a link on the public
// page. The importer already refuses userinfo; the recipe API and the restore path must too.

const withUrl = (source_url: string) => ({
  ...structuredClone(SAMPLE_SKILLET_COOKIES),
  source_url,
});
const docWithUrl = (u: string) => ({
  ...validDoc(),
  recipes: [{ ...validRecipe(), source_url: u }],
});

describe('source_url userinfo', () => {
  it.each([
    'http://user:pw@evil.example/',
    'https://user@evil.example/x',
    'https://:pw@evil.example/',
    'http://a:b@127.0.0.1/',
  ])('recipe API rejects %s', (u) => {
    expect(recipeInputSchema.safeParse(withUrl(u)).success).toBe(false);
  });

  it.each(['http://user:pw@evil.example/', 'https://user@evil.example/x'])(
    'restore schema rejects %s',
    (u) => {
      expect(backupV1Schema.safeParse(docWithUrl(u)).success).toBe(false);
    },
  );

  it('controls: plain http(s) URLs (also with an @ in the path or query) still pass', () => {
    for (const u of [
      'https://example.com/a',
      'http://example.com:8080/x?e=a@b.c',
      'https://example.com/@user',
    ]) {
      expect(recipeInputSchema.safeParse(withUrl(u)).success).toBe(true);
      expect(backupV1Schema.safeParse(docWithUrl(u)).success).toBe(true);
    }
  });
});
