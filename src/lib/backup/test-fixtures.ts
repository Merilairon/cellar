// Test-only helpers for the backup tests (not imported by app code).
import { ulid } from 'ulid';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { createRecipe, setShareToken } from '@/lib/db/recipes';
import { note, photo, rating, user } from '@/lib/db/schema';
import { prepareRecipe } from '@/lib/recipes/service';
import { SAMPLE_RECIPES } from '@/lib/recipes/samples';
import type { RecipeInput } from '@/lib/recipes/schemas';

export function memDb(): Db {
  const db = openDb(':memory:');
  runMigrations(db);
  return db;
}

export type U = { id: string; email: string; displayName: string; role: 'admin' | 'member' };

export function mkUser(
  db: Db,
  email: string,
  role: 'admin' | 'member' = 'member',
  passwordHash = `$argon2id$v=19$m=19456,t=2,p=1$hash-of-${email}`,
): U {
  return db
    .insert(user)
    .values({ email, displayName: `Name of ${email.split('@')[0]}`, passwordHash, role })
    .returning({ id: user.id, email: user.email, displayName: user.displayName, role: user.role })
    .get();
}

/** Persist a RecipeInput through the real validation + insert path. Returns the new id. */
export function saveInput(db: Db, ownerId: string, input: RecipeInput): string {
  const prepared = prepareRecipe(input);
  if (!prepared.ok) throw new Error(`fixture invalid: ${JSON.stringify(prepared)}`);
  return createRecipe(db, ownerId, prepared.tree);
}

/** 20 sections, a split group in each, 20 tags, grid spans, all fields set. */
export function maximalRecipe(): RecipeInput {
  const sections = Array.from({ length: 20 }, (_, s) => ({
    title: `Section ${s + 1}`,
    ingredients: Array.from({ length: 12 }, (_, i) => ({
      name: `ingredient ${s}-${i}`,
      note: i % 3 === 0 ? 'chopped' : null,
      raw_text: `${i + 1} cup (${(i + 1) * 120} mL) ingredient ${s}-${i}`,
      metric_qty: (i + 1) * 120,
      metric_qty_max: i % 4 === 0 ? (i + 1) * 120 + 60 : null,
      metric_unit: 'mL',
      us_qty: i + 1,
      us_qty_max: i % 4 === 0 ? i + 1.5 : null,
      us_unit: 'cup',
      display_primary: (i % 2 === 0 ? 'metric' : 'us') as 'metric' | 'us',
      split_group_id: i === 0 || i === 1 ? `grp-${s}` : null,
      portion_label: i === 0 || i === 1 ? `part ${s}` : null,
      group_label: i === 2 ? 'for the dough' : null,
    })),
    steps: [
      ...(s % 2 === 0 ? [{ kind: 'banner_top' as const, label: 'prep', detail: `Prep ${s}` }] : []),
      { kind: 'column' as const, label: 'mix', detail: 'Mix.', row_start: 0, row_end: 3 },
      {
        kind: 'column' as const,
        label: 'bake',
        detail: 'Bake.',
        row_start: 2,
        row_end: 11,
        temp_c: 180,
        temp_f: 356,
        minutes_min: 10,
        minutes_max: 20,
      },
      { kind: 'banner_bottom' as const, label: 'rest', detail: 'Rest.' },
    ],
  }));
  return {
    title: 'Maximal',
    description: 'd'.repeat(200),
    servings: 12.5,
    servings_label: 'slices',
    prep_minutes: 30,
    cook_minutes: 90,
    source_url: 'https://example.test/recipe',
    source_name: 'Example',
    visibility: 'users',
    view_mode: 'grid',
    sections,
    tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
  };
}

export const photoFile = () => `${ulid()}.webp`;

export function addPhotos(db: Db, recipeId: string, n: number, legacyThumbLast = false): void {
  for (let i = 0; i < n; i++) {
    db.insert(photo)
      .values({
        recipeId,
        filePath: photoFile(),
        thumbPath: legacyThumbLast && i === n - 1 ? null : photoFile(),
        width: 800 + i,
        height: 600 + i,
        position: i * 2, // gaps on purpose: the export renumbers
        isCover: i === 0,
      })
      .run();
  }
}

export const addNote = (db: Db, recipeId: string, userId: string, body: string, shared: boolean) =>
  db.insert(note).values({ recipeId, userId, body, shared }).run();
export const addRating = (db: Db, recipeId: string, userId: string, stars: number) =>
  db.insert(rating).values({ recipeId, userId, stars }).run();

export const SAMPLE_INPUTS = SAMPLE_RECIPES;
export { setShareToken };
