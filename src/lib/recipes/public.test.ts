import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { recipe, user } from '@/lib/db/schema';
import { deleteRecipe, setShareToken } from '@/lib/db/recipes';
import { createNoteFor } from './notes';
import { setRatingFor } from './ratings';
import { getPublicRecipe } from './public';
import { createRecipeFor } from './service';
import { SAMPLE_SKILLET_COOKIES } from './samples';
import { generateShareToken } from './share';

const SHARE = { baseUrl: '', publicLinksEnabled: false };

const ON = { PUBLIC_LINKS_ENABLED: true };
const OFF = { PUBLIC_LINKS_ENABLED: false };

let db: Db;
let ownerId: string;
let id: string;
let token: string;

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db);
  const owner = db
    .insert(user)
    .values({
      email: 'owner-secret@x.test',
      displayName: 'Ownerly McOwnerface',
      passwordHash: 'h',
      role: 'member',
    })
    .returning()
    .get();
  ownerId = owner.id;
  const created = createRecipeFor(
    db,
    { id: ownerId, role: 'member' },
    SAMPLE_SKILLET_COOKIES,
    SHARE,
  );
  if (!created.ok) throw new Error('seed failed');
  id = created.recipe.id;
  token = generateShareToken();
  setShareToken(db, id, token);
});
afterEach(() => db.$client.close());

describe('getPublicRecipe', () => {
  it('returns the recipe for a valid, enabled token, regardless of visibility', () => {
    const r = getPublicRecipe(db, token, ON);
    expect(r?.title).toBe(SAMPLE_SKILLET_COOKIES.title);
    expect(r?.sections.length).toBeGreaterThan(0);
    db.update(recipe).set({ visibility: 'users' }).where(eq(recipe.id, id)).run();
    expect(getPublicRecipe(db, token, ON)).not.toBeNull();
  });

  it.each([
    ['empty', ''],
    ['short', 'abc'],
    ['21 chars', 'a'.repeat(21)],
    ['23 chars', 'a'.repeat(23)],
    ['bad alphabet', '+/=' + 'a'.repeat(19)],
    ['dots', '..'],
    ['dots padded', '.'.repeat(22)],
    ['trailing newline', 'a'.repeat(22) + '\n'],
    ['unicode', 'é'.repeat(22)],
  ])('malformed token (%s) returns null', (_n, t) => {
    expect(getPublicRecipe(db, t, ON)).toBeNull();
  });

  it('a malformed token never reaches the database lookup', () => {
    const spy = db as unknown as { select: () => never };
    const orig = spy.select;
    spy.select = () => {
      throw new Error('db touched');
    };
    try {
      expect(getPublicRecipe(db, 'abc', ON)).toBeNull();
    } finally {
      spy.select = orig;
    }
  });

  it('unknown token (well-formed) returns null', () => {
    expect(getPublicRecipe(db, generateShareToken(), ON)).toBeNull();
  });

  it('a token differing in one character returns null', () => {
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    expect(getPublicRecipe(db, flipped, ON)).toBeNull();
  });

  it('revoked token returns null; rotated old token returns null, new one works', () => {
    const fresh = generateShareToken();
    setShareToken(db, id, fresh);
    expect(getPublicRecipe(db, token, ON)).toBeNull();
    expect(getPublicRecipe(db, fresh, ON)).not.toBeNull();
    setShareToken(db, id, null);
    expect(getPublicRecipe(db, fresh, ON)).toBeNull();
  });

  it('deleted recipe returns null', () => {
    expect(deleteRecipe(db, id)).toBe(true);
    expect(getPublicRecipe(db, token, ON)).toBeNull();
  });

  it('PUBLIC_LINKS_ENABLED=false makes a stored token inert, and re-enabling restores it', () => {
    expect(getPublicRecipe(db, token, OFF)).toBeNull();
    expect(getPublicRecipe(db, token, ON)).not.toBeNull();
  });

  it('every failure is the same value', () => {
    const failures = [
      getPublicRecipe(db, 'abc', ON),
      getPublicRecipe(db, generateShareToken(), ON),
      getPublicRecipe(db, token, OFF),
    ];
    for (const f of failures) expect(Object.is(f, null)).toBe(true);
  });

  it('serializes no note, rating, owner, token, visibility or edit state', () => {
    const me = { id: ownerId, role: 'member' as const, displayName: 'Ownerly McOwnerface' };
    const note = createNoteFor(db, me, id, { body: 'PRIVATE-NOTE-TEXT-9f3' });
    expect(note.ok).toBe(true);
    expect(setRatingFor(db, me, id, { stars: 4 }).ok).toBe(true);

    const r = getPublicRecipe(db, token, ON);
    expect(r).not.toBeNull();
    const json = JSON.stringify(r);
    for (const needle of [
      'PRIVATE-NOTE-TEXT-9f3',
      ownerId,
      id,
      'owner-secret@x.test',
      'Ownerly McOwnerface',
      token,
    ]) {
      expect(json).not.toContain(needle);
    }
    for (const key of [
      'visibility',
      'share',
      'share_token',
      'shareToken',
      'owner_id',
      'ownerId',
      'can_edit',
      'rating',
      'my_rating',
      'notes',
      'photos',
      'copied_from_id',
      'public_links_enabled',
    ]) {
      expect(json).not.toMatch(new RegExp(`"[a-z_]*${key}[a-z_]*"\\s*:`, 'i'));
    }
    expect(Object.keys(r!).sort()).toEqual(
      [
        'cook_minutes',
        'description',
        'prep_minutes',
        'servings',
        'servings_label',
        'sections',
        'source_name',
        'source_url',
        'tags',
        'title',
        'view_mode',
      ].sort(),
    );
  });
});
