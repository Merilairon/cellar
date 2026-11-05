import { describe, expect, it } from 'vitest';
import { canRead, canWrite } from './access';

const owner = { id: 'o', role: 'member' as const };
const other = { id: 'x', role: 'member' as const };
const admin = { id: 'a', role: 'admin' as const };

describe('access matrix', () => {
  const cases: Array<[string, typeof owner | typeof admin, 'private' | 'users', boolean, boolean]> =
    [
      ['owner private', owner, 'private', true, true],
      ['owner users', owner, 'users', true, true],
      ['other private', other, 'private', false, false],
      ['other users', other, 'users', true, false],
      ['admin private', admin, 'private', true, true],
      ['admin users', admin, 'users', true, true],
    ];
  it.each(cases)('%s', (_n, actor, visibility, read, write) => {
    const r = { ownerId: 'o', visibility };
    expect(canRead(actor, r)).toBe(read);
    expect(canWrite(actor, r)).toBe(write);
  });
});
