import type { Db } from '@/lib/db/connection';
import {
  deactivateUserGuarded,
  deleteUserGuarded,
  listUsers,
  type DeactivateResult,
  type DeleteResult,
} from '@/lib/db/users';

/** Pure admin operations (policy checks like requireAdmin live in current-user.ts). */
export function listUsersForAdmin(db: Db) {
  return listUsers(db).map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    active: !u.deactivatedAt,
  }));
}

/**
 * Deactivate a user and revoke their sessions. The last active admin can never be
 * deactivated (including by themselves); enforced atomically in the db layer.
 */
export function deactivateUser(db: Db, targetId: string, now: Date = new Date()): DeactivateResult {
  return deactivateUserGuarded(db, targetId, now);
}

export type RecipeChoice = { recipes: 'delete' } | { recipes: 'reassign'; reassignTo: string };

/**
 * Permanently delete a user (sessions, invites, resets cascade). The recipe choice is
 * validated here; it is not persisted until recipes exist.
 * TODO(M2): pass the choice to the db layer to reassign/delete recipes.
 */
export function deleteUser(db: Db, targetId: string, choice: RecipeChoice): DeleteResult {
  return deleteUserGuarded(
    db,
    targetId,
    choice.recipes === 'reassign' ? { reassignTo: choice.reassignTo } : {},
  );
}
