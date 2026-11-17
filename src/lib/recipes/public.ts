import type { Db } from '@/lib/db/connection';
import { getRecipeFull, getRecipeRowByShareToken } from '@/lib/db/recipes';
import { canView } from './access';
import { SHARE_TOKEN_RE } from './share';
import { toApiRecipe, type ApiRecipe } from './service';

/**
 * What an anonymous visitor of `/r/<token>` may see (G7, R11). Built by picking fields, never by
 * deleting them from `ApiRecipe`, so a field added to the API later stays private by default:
 * no ids of the recipe or its owner, visibility, share state, `can_edit`, ratings, notes,
 * photos, copy lineage or timestamps. Section, ingredient and step ids are kept because the
 * grid keys its cells and its detail panels by them; they are row ids of no use on their own.
 */
export type PublicRecipe = Pick<
  ApiRecipe,
  | 'title'
  | 'description'
  | 'servings'
  | 'servings_label'
  | 'prep_minutes'
  | 'cook_minutes'
  | 'source_url'
  | 'source_name'
  | 'view_mode'
  | 'tags'
  | 'sections'
>;

/**
 * Resolve a share token to the stripped recipe, or `null`. Every failure (malformed token,
 * unknown, revoked, recipe deleted, links disabled) returns the same `null`, so the page
 * answers all of them with the one `notFound()` (R4). The format gate fixes the length that
 * `canView`'s constant-time comparison would otherwise leak; the lookup is an exact index hit
 * and the stored token is compared again in `canView`.
 */
export function getPublicRecipe(
  db: Db,
  token: string,
  env: { PUBLIC_LINKS_ENABLED: boolean },
  /** Called once with the recipe id of a successful resolve (the id is not part of the result). */
  onHit?: (recipeId: string) => void,
): PublicRecipe | null {
  if (!env.PUBLIC_LINKS_ENABLED) return null;
  if (typeof token !== 'string' || !SHARE_TOKEN_RE.test(token)) return null;
  const row = getRecipeRowByShareToken(db, token);
  if (!row) return null;
  if (!canView(null, row, { token, publicLinksEnabled: env.PUBLIC_LINKS_ENABLED })) return null;
  const full = getRecipeFull(db, row.id);
  if (!full) return null;
  try {
    onHit?.(row.id);
  } catch {
    // A logging hook must never turn the page into a 500.
  }
  // No photos, rating or share context: the full mapper is reused only for the section tree.
  const api = toApiRecipe(full, false);
  return {
    title: api.title,
    description: api.description,
    servings: api.servings,
    servings_label: api.servings_label,
    prep_minutes: api.prep_minutes,
    cook_minutes: api.cook_minutes,
    source_url: api.source_url,
    source_name: api.source_name,
    view_mode: api.view_mode,
    tags: api.tags,
    sections: api.sections,
  };
}
