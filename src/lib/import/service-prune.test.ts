import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { importJob, user } from '@/lib/db/schema';
import { maybePrune, resetPruneThrottle } from './service';

let db: Db;
let dir: string;
beforeEach(() => {
  resetPruneThrottle();
  db = openDb(':memory:');
  runMigrations(db);
  dir = mkdtempSync(join(tmpdir(), 'prune-svc-'));
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const addOld = (userId: string) =>
  db
    .insert(importJob)
    .values({ userId, status: 'failed', updatedAt: '2020-01-01T00:00:00.000Z' })
    .run();

describe('maybePrune', () => {
  it('prunes at most once per hour and respects TTL 0', () => {
    const u = db
      .insert(user)
      .values({ email: 'a@x.test', displayName: 'a', passwordHash: 'h', role: 'member' })
      .returning()
      .get();
    const now = Date.parse('2026-06-01T00:00:00Z');
    addOld(u.id);
    maybePrune(db, { jobTtlDays: 0, rawHtmlDir: dir }, now);
    expect(db.select().from(importJob).all()).toHaveLength(1);
    maybePrune(db, { jobTtlDays: 30, rawHtmlDir: dir }, now);
    expect(db.select().from(importJob).all()).toHaveLength(0);
    addOld(u.id);
    maybePrune(db, { jobTtlDays: 30, rawHtmlDir: dir }, now + 60_000);
    expect(db.select().from(importJob).all()).toHaveLength(1);
    maybePrune(db, { jobTtlDays: 30, rawHtmlDir: dir }, now + 3_700_000);
    expect(db.select().from(importJob).all()).toHaveLength(0);
  });
});
