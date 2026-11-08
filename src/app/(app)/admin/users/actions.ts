'use server';

import { headers } from 'next/headers';
import { deactivateUser, deleteUser } from '@/lib/auth/admin';
import { requireAdmin } from '@/lib/auth/current-user';
import { isCsrfSafe } from '@/lib/auth/csrf';
import { createInvite } from '@/lib/auth/invites';
import { issuePasswordReset } from '@/lib/auth/resets';
import { deleteUserSchema, inviteCreateSchema, userIdSchema } from '@/lib/auth/schemas';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { revalidatePath } from 'next/cache';

export type ActionState = { link?: string; expiresAt?: string; message?: string; error?: string };

/** Every action: CSRF proof, then server-side admin check, then zod, then the operation. */
async function guard(): Promise<{ adminId: string } | { error: string }> {
  if (!isCsrfSafe('POST', await headers(), getEnv().BASE_URL)) {
    return { error: 'admin.users.errors.csrf' };
  }
  const admin = await requireAdmin();
  if (!admin.ok) return { error: 'admin.users.errors.forbidden' };
  return { adminId: admin.user.id };
}

export async function createInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const g = await guard();
  if ('error' in g) return g;
  const parsed = inviteCreateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'admin.users.errors.invalidInput' };
  const { link, expiresAt } = createInvite(getDb(), {
    createdBy: g.adminId,
    email: parsed.data.email,
    baseUrl: getEnv().BASE_URL,
  });
  return { link, expiresAt: expiresAt.toISOString() };
}

export async function createResetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const g = await guard();
  if ('error' in g) return g;
  const parsed = userIdSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'admin.users.errors.invalidInput' };
  const res = issuePasswordReset(getDb(), {
    userId: parsed.data.userId,
    createdBy: g.adminId,
    baseUrl: getEnv().BASE_URL,
  });
  if (!res) return { error: 'admin.users.errors.resetUnavailable' };
  return { link: res.link, expiresAt: res.expiresAt.toISOString() };
}

export async function deactivateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const g = await guard();
  if ('error' in g) return g;
  const parsed = userIdSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'admin.users.errors.invalidInput' };
  const result = deactivateUser(getDb(), parsed.data.userId);
  const errors = {
    last_admin: 'admin.users.errors.lastAdmin',
    not_found: 'admin.users.errors.notFound',
    already_deactivated: 'admin.users.errors.alreadyDeactivated',
  } as const;
  if (result !== 'ok') return { error: errors[result] };
  revalidatePath('/admin/users');
  return { message: 'admin.users.deactivated' };
}

export async function deleteUserAction(_: ActionState, form: FormData): Promise<ActionState> {
  const g = await guard();
  if ('error' in g) return g;
  const parsed = deleteUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'admin.users.errors.invalidInput' };
  const { userId, ...choice } = parsed.data;
  const result = deleteUser(getDb(), userId, choice, { uploadsDir: getEnv().UPLOADS_DIR });
  const errors = {
    last_admin: 'admin.users.errors.lastAdminDelete',
    not_found: 'admin.users.errors.notFound',
    invalid_reassign_target: 'admin.users.errors.invalidReassign',
  } as const;
  if (result !== 'ok') return { error: errors[result] };
  revalidatePath('/admin/users');
  return { message: 'admin.users.deleted' };
}
