import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces an argon2id hash that verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
  });
  it('rejects a wrong password and a malformed hash', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
  it('salts: same password hashes differently', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });
});
