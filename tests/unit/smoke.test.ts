import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

describe('env', () => {
  it('parses a valid environment with defaults', () => {
    const env = parseEnv({ SESSION_SECRET: 'x'.repeat(32), TRUSTED_PROXIES: '10.0.0.1, 10.0.0.2' });
    expect(env.BASE_URL).toBe('http://localhost:3000');
    expect(env.TRUSTED_PROXIES).toEqual(['10.0.0.1', '10.0.0.2']);
  });
});
