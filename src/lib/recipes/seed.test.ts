import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { getRecipeFull } from '@/lib/db/recipes';
import { listRecipeIdsByOwner } from '@/lib/db/test-helpers';
import { user } from '@/lib/db/schema';
import { seedSamples } from './seed';

let db: Db;
afterEach(() => db.$client.close());
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
};
const mk = (email: string, role: 'admin' | 'member', createdAt: string, deactivatedAt?: string) =>
  db
    .insert(user)
    .values({ email, displayName: email, passwordHash: 'h', role, createdAt, deactivatedAt })
    .returning()
    .get();

describe('seedSamples', () => {
  it('fails clearly without an admin', () => {
    setup();
    mk('m@x.test', 'member', '2026-01-01T00:00:00Z');
    const r = seedSamples(db);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/No active admin/);
  });

  it('assigns both samples to the oldest active admin, in grid mode, idempotently', () => {
    setup();
    mk('gone@x.test', 'admin', '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z');
    const a = mk('a@x.test', 'admin', '2026-01-01T00:00:00Z');
    mk('b@x.test', 'admin', '2026-02-01T00:00:00Z');
    const first = seedSamples(db);
    expect(first.ok && first.created).toEqual([
      'Mocha Skillet Cookie',
      'Vanilla Cake with Frosting',
    ]);
    const ids = listRecipeIdsByOwner(db, a.id);
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => getRecipeFull(db, id)!.viewMode)).toEqual(['grid', 'grid']);
    const second = seedSamples(db);
    expect(second.ok && second.created).toEqual([]);
    expect(second.ok && second.skipped).toHaveLength(2);
    expect(listRecipeIdsByOwner(db, a.id)).toHaveLength(2);
  });

  it('--user targets a given active user and rejects unknown ones', () => {
    setup();
    mk('a@x.test', 'admin', '2026-01-01T00:00:00Z');
    const m = mk('m@x.test', 'member', '2026-02-01T00:00:00Z');
    expect(seedSamples(db, 'M@x.test').ok).toBe(true);
    expect(listRecipeIdsByOwner(db, m.id)).toHaveLength(2);
    expect(seedSamples(db, 'nobody@x.test')).toMatchObject({ ok: false });
  });
});
