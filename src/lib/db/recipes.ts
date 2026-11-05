import { asc, desc, eq, or } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './connection';
import { ingredient, nowIso, recipe, section, step, user } from './schema';

// Data access for recipes. No business rules beyond persistence: authorization and
// grid validation live in src/lib/recipes/.

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

export type RecipeRow = typeof recipe.$inferSelect;
export type SectionRow = typeof section.$inferSelect;
export type IngredientRow = typeof ingredient.$inferSelect;
export type StepRow = typeof step.$inferSelect;

export type RecipeFields = Pick<
  typeof recipe.$inferInsert,
  | 'title'
  | 'description'
  | 'servings'
  | 'servingsLabel'
  | 'prepMinutes'
  | 'cookMinutes'
  | 'sourceUrl'
  | 'sourceName'
  | 'visibility'
  | 'viewMode'
>;
type IngredientData = Omit<
  typeof ingredient.$inferInsert,
  'id' | 'recipeId' | 'sectionId' | 'position'
>;
type StepData = Omit<typeof step.$inferInsert, 'id' | 'recipeId' | 'sectionId' | 'position'>;

/** Children are positioned by array index. `splitGroupId` values are remapped to fresh ULIDs on write. */
export type RecipeTree = {
  fields: RecipeFields;
  sections: Array<{ title: string | null; ingredients: IngredientData[]; steps: StepData[] }>;
};

export type RecipeFull = RecipeRow & {
  sections: Array<SectionRow & { ingredients: IngredientRow[]; steps: StepRow[] }>;
};

function insertSections(tx: Conn, recipeId: string, sections: RecipeTree['sections']): void {
  const groups = new Map<string, string>();
  const remap = (g: string | null | undefined): string | null => {
    if (!g) return null;
    let id = groups.get(g);
    if (!id) groups.set(g, (id = ulid()));
    return id;
  };
  sections.forEach((sec, si) => {
    const sectionId = ulid();
    tx.insert(section).values({ id: sectionId, recipeId, position: si, title: sec.title }).run();
    sec.ingredients.forEach((ing, i) =>
      tx
        .insert(ingredient)
        .values({
          ...ing,
          recipeId,
          sectionId,
          position: i,
          splitGroupId: remap(ing.splitGroupId),
        })
        .run(),
    );
    sec.steps.forEach((st, i) =>
      tx
        .insert(step)
        .values({ ...st, recipeId, sectionId, position: i })
        .run(),
    );
  });
}

/** Create a recipe and all children in one transaction; returns the new id. */
export function createRecipe(db: Db, ownerId: string, tree: RecipeTree): string {
  return db.transaction(
    (tx) => {
      const now = nowIso();
      const id = ulid();
      tx.insert(recipe)
        .values({ ...tree.fields, id, ownerId, createdAt: now, updatedAt: now })
        .run();
      insertSections(tx, id, tree.sections);
      return id;
    },
    { behavior: 'immediate' },
  );
}

/**
 * Replace a recipe's fields and ALL children atomically (delete sections, re-insert).
 * Child ids change. Returns false if the recipe does not exist. If any insert fails the
 * transaction rolls back and the original recipe is untouched.
 */
export function replaceRecipe(db: Db, id: string, tree: RecipeTree): boolean {
  return db.transaction(
    (tx) => {
      const updated = tx
        .update(recipe)
        .set({ ...tree.fields, updatedAt: nowIso() })
        .where(eq(recipe.id, id))
        .returning({ id: recipe.id })
        .all();
      if (updated.length === 0) return false;
      tx.delete(section).where(eq(section.recipeId, id)).run(); // cascades to ingredient and step
      insertSections(tx, id, tree.sections);
      return true;
    },
    { behavior: 'immediate' },
  );
}

export function getRecipeRow(db: Db, id: string): RecipeRow | undefined {
  return db.select().from(recipe).where(eq(recipe.id, id)).get();
}

function loadFull(conn: Conn, id: string): RecipeFull | undefined {
  const r = conn.select().from(recipe).where(eq(recipe.id, id)).get();
  if (!r) return undefined;
  const sections = conn
    .select()
    .from(section)
    .where(eq(section.recipeId, id))
    .orderBy(asc(section.position))
    .all();
  const ings = conn
    .select()
    .from(ingredient)
    .where(eq(ingredient.recipeId, id))
    .orderBy(asc(ingredient.position))
    .all();
  const steps = conn
    .select()
    .from(step)
    .where(eq(step.recipeId, id))
    .orderBy(asc(step.position))
    .all();
  return {
    ...r,
    sections: sections.map((s) => ({
      ...s,
      ingredients: ings.filter((i) => i.sectionId === s.id),
      steps: steps.filter((t) => t.sectionId === s.id),
    })),
  };
}

export function getRecipeFull(db: Db, id: string): RecipeFull | undefined {
  return loadFull(db, id);
}

export type RecipeListItem = {
  id: string;
  title: string;
  ownerId: string;
  ownerDisplayName: string;
  visibility: RecipeRow['visibility'];
  viewMode: RecipeRow['viewMode'];
  updatedAt: string;
};

/** The caller's own recipes plus other users' `users`-visible recipes, newest first. */
export function listRecipesForUser(db: Db, userId: string): RecipeListItem[] {
  return db
    .select({
      id: recipe.id,
      title: recipe.title,
      ownerId: recipe.ownerId,
      ownerDisplayName: user.displayName,
      visibility: recipe.visibility,
      viewMode: recipe.viewMode,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .innerJoin(user, eq(user.id, recipe.ownerId))
    .where(or(eq(recipe.ownerId, userId), eq(recipe.visibility, 'users')))
    .orderBy(desc(recipe.updatedAt), desc(recipe.id))
    .all();
}

/** Delete a recipe; sections, ingredients and steps cascade, copies get `copied_from_id = null`. */
export function deleteRecipe(db: Db, id: string): boolean {
  return db.delete(recipe).where(eq(recipe.id, id)).returning({ id: recipe.id }).all().length > 0;
}

export function setRecipeVisibility(
  db: Db,
  id: string,
  visibility: RecipeRow['visibility'],
): boolean {
  return (
    db
      .update(recipe)
      .set({ visibility, updatedAt: nowIso() })
      .where(eq(recipe.id, id))
      .returning({ id: recipe.id })
      .all().length > 0
  );
}

/**
 * Deep copy into `newOwnerId`'s book: fresh ids everywhere, split groups remapped,
 * private, `copied_from_id` = source, no share token, `view_mode` kept.
 * Returns the new id, or undefined if the source does not exist.
 */
export function copyRecipe(db: Db, sourceId: string, newOwnerId: string): string | undefined {
  return db.transaction(
    (tx) => {
      const src = loadFull(tx, sourceId);
      if (!src) return undefined;
      const now = nowIso();
      const id = ulid();
      tx.insert(recipe)
        .values({
          id,
          ownerId: newOwnerId,
          title: src.title,
          description: src.description,
          servings: src.servings,
          servingsLabel: src.servingsLabel,
          prepMinutes: src.prepMinutes,
          cookMinutes: src.cookMinutes,
          sourceUrl: src.sourceUrl,
          sourceName: src.sourceName,
          visibility: 'private',
          shareToken: null,
          copiedFromId: src.id,
          viewMode: src.viewMode,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      insertSections(
        tx,
        id,
        src.sections.map((s) => ({
          title: s.title,
          ingredients: s.ingredients.map(stripKeys),
          steps: s.steps.map(stripKeys),
        })),
      );
      return id;
    },
    { behavior: 'immediate' },
  );
}

/** Drop the identity/position columns so a row can be re-inserted under new parents. */
function stripKeys<T extends { id: string; recipeId: string; sectionId: string; position: number }>(
  row: T,
): Omit<T, 'id' | 'recipeId' | 'sectionId' | 'position'> {
  const rest: Partial<T> = { ...row };
  delete rest.id;
  delete rest.recipeId;
  delete rest.sectionId;
  delete rest.position;
  return rest as Omit<T, 'id' | 'recipeId' | 'sectionId' | 'position'>;
}

/** Ids of recipes owned by a user (used by the user-deletion flow and tests). */
export function listRecipeIdsByOwner(db: Db, ownerId: string): string[] {
  return db
    .select({ id: recipe.id })
    .from(recipe)
    .where(eq(recipe.ownerId, ownerId))
    .all()
    .map((r) => r.id);
}
