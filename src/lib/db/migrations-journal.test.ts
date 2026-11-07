import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { openDb } from './connection';
import { MIGRATIONS_FOLDER } from './migrate';

type Entry = { idx: number; when: number; tag: string };
const readJournal = (folder: string) =>
  JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: Entry[] };

describe('drizzle journal', () => {
  it('has strictly increasing `when` values that are not in the future', () => {
    const { entries } = readJournal(MIGRATIONS_FOLDER);
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i]!.idx).toBe(i);
      expect(entries[i]!.when).toBeLessThanOrEqual(Date.now());
      if (i > 0) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when);
    }
  });

  it('a database that already applied 0006 with the old future `when` keeps working', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jrnl-'));
    const db = openDb(':memory:');
    try {
      cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
      const jp = join(dir, 'meta', '_journal.json');
      const journal = readJournal(dir);
      const fixed = journal.entries[6]!.when;
      journal.entries[6]!.when = 1794140000000; // what shipped in the dev builds
      writeFileSync(jp, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      journal.entries[6]!.when = fixed; // the corrected journal
      writeFileSync(jp, JSON.stringify(journal));
      migrate(db, { migrationsFolder: dir });
      const rows = db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as {
        n: number;
      };
      expect(rows.n).toBe(journal.entries.length); // nothing re-applied, nothing skipped
    } finally {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
