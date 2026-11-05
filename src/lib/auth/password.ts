import argon2 from 'argon2';

/**
 * Argon2id parameters (OWASP minimum profile): memory 19 MiB, t=2, p=1.
 * Raise after benchmarking on the target hardware (Raspberry Pi).
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128; // bounds hashing cost for attacker-supplied input

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Returns false on mismatch or a malformed hash; never throws for bad input. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Verify against a throwaway hash so unknown-email logins cost the same as known ones. */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummy, password);
}
