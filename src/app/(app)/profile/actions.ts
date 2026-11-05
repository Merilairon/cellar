'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/auth/current-user';
import { isCsrfSafe } from '@/lib/auth/csrf';
import { profileSchema } from '@/lib/auth/schemas';
import { getDb } from '@/lib/db';
import { setUnitPref } from '@/lib/db/users';
import { getEnv } from '@/lib/env';

export type ProfileState = { message?: string; error?: string };

export async function updateProfileAction(_: ProfileState, form: FormData): Promise<ProfileState> {
  if (!isCsrfSafe('POST', await headers(), getEnv().BASE_URL)) {
    return { error: 'profile.errors.csrf' };
  }
  const user = await getCurrentUser();
  if (!user) return { error: 'profile.errors.unauthenticated' };
  const parsed = profileSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'profile.errors.invalidInput' };
  setUnitPref(getDb(), user.id, parsed.data.unitPref);
  revalidatePath('/profile');
  return { message: 'profile.saved' };
}
