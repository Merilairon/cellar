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
