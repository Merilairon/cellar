import { describe, expect, it } from 'vitest';
import { migrateBackup } from './migrate';
import { validAllDoc, validDoc, validRecipe } from './schema-fixtures';

describe('migrateBackup', () => {
  it('accepts a v1 document and returns it', () => {
    const r = migrateBackup(validDoc());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.version).toBe(1);
  });
  it.each([
    ['version 2', 2, 2],
    ['version 99', 99, 99],
    ['version 0', 0, 0],
    ['version -1', -1, -1],
    ['version 1.5', 1.5, 1.5],
    ["version '1'", '1', 'string'],
    ['version null', null, null],
    ['version true', true, true],
  ])('%s -> backup_version_unsupported with the found value', (_n, version, found) => {
    const r = migrateBackup({ ...validDoc(), version });
    expect(r).toEqual({ ok: false, code: 'backup_version_unsupported', version: found });
  });
  it('reports object and array versions by kind, never echoing them', () => {
    expect(migrateBackup({ version: { evil: 1 } })).toMatchObject({ version: 'object' });
    expect(migrateBackup({ version: [1] })).toMatchObject({ version: 'array' });
  });
  it('never echoes attacker text from a string version', () => {
    const r = migrateBackup({ version: 'x\u001b[31m'.repeat(100) });
    expect(r).toEqual({ ok: false, code: 'backup_version_unsupported', version: 'string' });
  });
  it('missing version -> backup_invalid', () => {
    const rest: Record<string, unknown> = { ...validDoc() };
    delete rest.version;
    expect(migrateBackup(rest)).toMatchObject({ ok: false, code: 'backup_invalid' });
  });
  it.each([
    ['null', null],
    ['string', 'x'],
    ['number', 3],
    ['array', [1]],
    ['undefined', undefined],
  ])('non-object %s -> backup_invalid', (_n, raw) => {
    expect(migrateBackup(raw)).toMatchObject({ ok: false, code: 'backup_invalid' });
  });
  it('a v1 with a schema violation -> backup_invalid with paths', () => {
    const doc = validDoc();
    doc.recipes[0].title = '';
    const r = migrateBackup(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('backup_invalid');
      expect(r.errors?.some((e) => e.path === 'recipes.0.title')).toBe(true);
    }
  });
  it('an unknown top-level key -> backup_invalid (strict)', () => {
    expect(migrateBackup({ ...validDoc(), extra: 1 })).toMatchObject({
      ok: false,
      code: 'backup_invalid',
    });
  });
  it('a 2 GB-looking recipe count is refused by the cap check before any per-item work', () => {
    const r = migrateBackup({ ...validDoc(), recipes: new Array(2_000_000_000) });
    expect(r).toMatchObject({ ok: false, errors: [{ path: 'recipes', code: 'too_many_recipes' }] });
  });
  it('5001 recipes -> backup_invalid too_many_recipes', () => {
    const r = migrateBackup({ ...validDoc(), recipes: new Array(5001).fill(null) });
    expect(r).toMatchObject({ ok: false, errors: [{ path: 'recipes', code: 'too_many_recipes' }] });
  });
  it('a parsed document with a __proto__ key -> backup_invalid', () => {
    const raw = JSON.parse(
      JSON.stringify(validDoc()).replace('"version":1', '"version":1,"__proto__":{"x":1}'),
    );
    expect(migrateBackup(raw)).toMatchObject({
      ok: false,
      code: 'backup_invalid',
      errors: [{ code: 'forbidden_key' }],
    });
  });
  it('caps the number of reported errors', () => {
    const doc = validDoc();
    doc.recipes = Array.from({ length: 100 }, () => ({ ...doc.recipes[0], title: '' }));
    const r = migrateBackup(doc);
    expect(r.ok === false && (r.errors?.length ?? 0)).toBeLessThanOrEqual(20);
  });
  it('total row cap: many in-cap recipes cannot add up past the document limit', () => {
    const r = validRecipe();
    r.notes = new Array(200).fill(r.notes[0]);
    const doc = { ...validDoc(), recipes: new Array(2000).fill(r) };
    expect(migrateBackup(doc)).toMatchObject({ ok: false, errors: [{ code: 'too_large' }] });
  });
  it('issue amplification is bounded', () => {
    const doc = validAllDoc();
    const r = doc.recipes[0];
    r.ratings = Array.from({ length: 1000 }, () => ({
      ...r.ratings[0],
      user_email: 'ghost@x.test',
    }));
    doc.recipes = new Array(100).fill(r);
    const res = migrateBackup(doc);
    expect(res.ok).toBe(false);
    expect(res.ok === false && (res.errors?.length ?? 0)).toBeLessThanOrEqual(20);
  });
});
