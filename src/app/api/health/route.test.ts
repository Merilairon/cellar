import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ healthy: true, throws: false }));
vi.mock('@/lib/db', () => ({
  getDb: () => {
    if (state.throws) throw new Error('SQLITE_CANTOPEN: /data/app.db');
    return {};
  },
}));
vi.mock('@/lib/db/health', () => ({ dbHealthy: () => state.healthy }));

import { GET } from './route';

beforeEach(() => {
  state.healthy = true;
  state.throws = false;
});

describe('GET /api/health', () => {
  it('200 with the status only', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('503 when the database does not answer', async () => {
    state.healthy = false;
    const res = GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error' });
  });

  it('503, not a throw, when the connection cannot be opened; the error text is not echoed', async () => {
    state.throws = true;
    const res = GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/SQLITE|app\.db/);
  });
});
