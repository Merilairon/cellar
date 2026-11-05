import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN } from './password';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const setupSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX),
});

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  email.optional(),
);
const token = z.string().min(20).max(100);

export const inviteCreateSchema = z.object({ email: optionalEmail });
export const userIdSchema = z.object({ userId: z.string().min(1).max(40) });
const userId = z.string().min(1).max(40);
export const deleteUserSchema = z.discriminatedUnion('recipes', [
  z.object({ userId, recipes: z.literal('delete') }),
  z.object({ userId, recipes: z.literal('reassign'), reassignTo: userId }),
]);
export const registerSchema = z.object({
  token,
  email: optionalEmail,
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export const resetSchema = z.object({
  token,
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

export const profileSchema = z.object({ unitPref: z.enum(['metric', 'us']) });
