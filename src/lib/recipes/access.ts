import type { Visibility } from './schemas';

type Actor = { id: string; role: 'admin' | 'member' };
type Resource = { ownerId: string; visibility: Visibility };

/** Read: owner, any admin, or any signed-in user when visibility is `users`. */
export function canRead(actor: Actor, recipe: Resource): boolean {
  return actor.role === 'admin' || recipe.ownerId === actor.id || recipe.visibility === 'users';
}

/** Write/delete/visibility: owner or admin only. */
export function canWrite(actor: Actor, recipe: Resource): boolean {
  return actor.role === 'admin' || recipe.ownerId === actor.id;
}
