import type { Db } from '@/lib/db/connection';
import { listPhotoPathsByOwner } from '@/lib/db/photos';
import { removeUploadFiles } from '@/lib/import/uploads';
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
 * applied atomically by the db layer: `delete` removes the user's recipes, `reassign`
 * moves them to `reassignTo` (validated there before anything changes). With `uploadsDir`,
 * a `delete` also unlinks the removed recipes' photo files after the commit (best effort;
 * the rows cascade, so without this the files would stay on disk unreachable, C2).
 */
export function deleteUser(
  db: Db,
  targetId: string,
  choice: RecipeChoice,
  opts: { uploadsDir?: string } = {},
): DeleteResult {
  const files =
    opts.uploadsDir && choice.recipes === 'delete' ? listPhotoPathsByOwner(db, targetId) : [];
  const result = deleteUserGuarded(db, targetId, choice);
  if (result === 'ok' && opts.uploadsDir && files.length > 0) {
    removeUploadFiles(opts.uploadsDir, files);
  }
  return result;
}
