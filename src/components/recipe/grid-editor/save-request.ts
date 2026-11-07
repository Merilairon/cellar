import {
  doc,
  mapServerErrors,
  toGridPayload,
  type EditorDoc,
  type EditorIssue,
  type EditorState,
} from '@/lib/grid/editor';
import type { GridIssue } from '@/lib/grid/validate';
import { call } from '../api';
import type { ApiRecipe } from '../types';

export type Request = typeof call;

export type SaveOutcome =
  | { kind: 'saved'; recipe: ApiRecipe }
  /** The server wrote the grid (200) but neither the body nor a refetch could be read. */
  | { kind: 'savedUnreadable' }
  /** `doc` is the document that was SENT: the paths index into it, not into later edits. */
  | { kind: 'rejected'; doc: EditorDoc; errors: EditorIssue[] }
  | { kind: 'conflict'; stamp: string }
  | { kind: 'failed' };

const readRecipe = async (res: Response | null): Promise<ApiRecipe | null> => {
  if (res?.status !== 200) return null;
  const r = (await res.json().catch(() => null)) as ApiRecipe | null;
  return r && typeof r.updated_at === 'string' ? r : null;
};

/**
 * One PUT of `sent` and its classification (pure of React, so the outcomes are unit-testable).
 *
 * A 200 means the write happened. If its body is unreadable the recipe is fetched again for the
 * new stamp; if that fails too the outcome is `savedUnreadable`, never `failed`: a retry would
 * send the old base and meet a 409 against the user's own save.
 */
export async function runGridSave(
  recipeId: string,
  sent: EditorState,
  base: string,
  request: Request = call,
): Promise<SaveOutcome> {
  const res = await request(`/api/recipes/${recipeId}/grid`, 'PUT', toGridPayload(sent, base));
  if (res?.status === 200) {
    const recipe =
      (await readRecipe(res)) ??
      (await readRecipe(await request(`/api/recipes/${recipeId}`, 'GET')));
    return recipe ? { kind: 'saved', recipe } : { kind: 'savedUnreadable' };
  }
  if (res?.status === 422) {
    const body = (await res.json().catch(() => null)) as { errors?: GridIssue[] } | null;
    if (Array.isArray(body?.errors)) {
      const sentDoc = doc(sent);
      return { kind: 'rejected', doc: sentDoc, errors: mapServerErrors(sentDoc, body.errors) };
    }
  } else if (res?.status === 409) {
    const body = (await res.json().catch(() => null)) as { updated_at?: string } | null;
    if (typeof body?.updated_at === 'string') return { kind: 'conflict', stamp: body.updated_at };
  }
  return { kind: 'failed' };
}
