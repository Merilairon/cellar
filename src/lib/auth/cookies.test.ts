import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
import { cookieOptions } from './cookies';

describe('cookieOptions', () => {
  const exp = new Date();
  it('is HttpOnly, Lax, Secure only for https BASE_URL', () => {
    const https = cookieOptions('https://x.test', exp);
    expect(https).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true });
    expect(cookieOptions('http://localhost:3000', exp).secure).toBe(false);
  });
});
