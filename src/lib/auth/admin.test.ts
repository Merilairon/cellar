import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { insertPhoto } from '@/lib/db/photos';
import { openDb, type Db } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { createRecipe, getRecipeFull } from '@/lib/db/recipes';
import { listRecipeIdsByOwner } from '@/lib/db/test-helpers';
import { invite, passwordReset, recipe, session, user } from '@/lib/db/schema';
import { copyRecipe } from '@/lib/db/recipes';
import { toTree } from '@/lib/recipes/service';
import { recipeInputSchema } from '@/lib/recipes/schemas';
import { SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { deactivateUser, deleteUser, listUsersForAdmin } from './admin';
import { deleteUserSchema } from './schemas';
import { createSession, validateSession } from './session';

let db: Db;
const mk = (email: string, role: 'admin' | 'member') =>
  db.insert(user).values({ email, displayName: email, passwordHash: 'h', role }).returning().get();
const setup = () => {
  db = openDb(':memory:');
  runMigrations(db);
};
afterEach(() => db.$client.close());

describe('admin operations', () => {
  it('lists users with status', () => {
    setup();
    mk('a@x.test', 'admin');
    expect(listUsersForAdmin(db)).toMatchObject([
      { email: 'a@x.test', role: 'admin', active: true },
    ]);
  });

  it('deactivation marks the user and invalidates all their sessions', () => {
    setup();
    mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const { token } = createSession(db, m.id);
    createSession(db, m.id);
    expect(deactivateUser(db, m.id)).toBe('ok');
    expect(validateSession(db, token)).toBeNull();
    expect(db.select().from(session).all()).toHaveLength(0);
    expect(deactivateUser(db, m.id)).toBe('already_deactivated');
    expect(deactivateUser(db, 'nope')).toBe('not_found');
  });

  it('refuses to deactivate the last active admin, even themselves', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const { token } = createSession(db, a.id);
    expect(deactivateUser(db, a.id)).toBe('last_admin');
    expect(validateSession(db, token)?.id).toBe(a.id);
  });

  it('allows deactivating an admin while another active admin exists; deactivated admins do not count', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const b = mk('b@x.test', 'admin');
    expect(deactivateUser(db, a.id)).toBe('ok');
    expect(deactivateUser(db, b.id)).toBe('last_admin');
  });
});

describe('deleteUser', () => {
  it('deletes a member, cascading sessions, invites and resets', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const { token } = createSession(db, m.id);
    db.insert(invite)
      .values({ tokenHash: 'i', createdBy: m.id, expiresAt: new Date().toISOString() })
      .run();
    db.insert(passwordReset)
      .values({ userId: m.id, tokenHash: 'r', createdBy: a.id, expiresAt: 'x' })
      .run();
    expect(deleteUser(db, m.id, { recipes: 'delete' })).toBe('ok');
    expect(validateSession(db, token)).toBeNull();
    expect(db.select().from(user).all()).toHaveLength(1);
    expect(db.select().from(invite).all()).toHaveLength(0);
    expect(db.select().from(passwordReset).all()).toHaveLength(0);
    expect(deleteUser(db, m.id, { recipes: 'delete' })).toBe('not_found');
  });

  it('keeps a reset created by a deleted admin, with created_by null', () => {
    setup();
    mk('a@x.test', 'admin');
    const b = mk('b@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    db.insert(passwordReset)
      .values({ userId: m.id, tokenHash: 'r', createdBy: b.id, expiresAt: 'x' })
      .run();
    expect(deleteUser(db, b.id, { recipes: 'delete' })).toBe('ok');
    expect(db.select().from(passwordReset).get()?.createdBy).toBeNull();
  });

  it('refuses the last active admin, including self; allows when another admin exists', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    mk('m@x.test', 'member');
    expect(deleteUser(db, a.id, { recipes: 'delete' })).toBe('last_admin');
    const b = mk('b@x.test', 'admin');
    expect(deleteUser(db, a.id, { recipes: 'reassign', reassignTo: b.id })).toBe('ok');
    expect(deleteUser(db, b.id, { recipes: 'delete' })).toBe('last_admin');
  });

  it('refuses invalid reassign targets and deletes nothing', () => {
    setup();
    mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const d = mk('d@x.test', 'member');
    deactivateUser(db, d.id);
    for (const reassignTo of ['nope', d.id, m.id]) {
      expect(deleteUser(db, m.id, { recipes: 'reassign', reassignTo })).toBe(
        'invalid_reassign_target',
      );
    }
    expect(db.select().from(user).all()).toHaveLength(3);
  });
});

describe('deleteUser with recipes', () => {
  const tree = () => toTree(recipeInputSchema.parse(SAMPLE_VANILLA_CAKE), 'grid');
  const count = (table: string) =>
    (db.$client.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;

  it("delete: removes the user's recipes and children; others' copies survive with copied_from_id null", () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const mine = createRecipe(db, m.id, tree());
    const keep = createRecipe(db, a.id, tree());
    const copyOfMine = copyRecipe(db, mine, a.id)!;
    expect(deleteUser(db, m.id, { recipes: 'delete' })).toBe('ok');
    expect(getRecipeFull(db, mine)).toBeUndefined();
    expect(getRecipeFull(db, keep)).toBeDefined();
    expect(getRecipeFull(db, copyOfMine)?.copiedFromId).toBeNull();
    expect(listRecipeIdsByOwner(db, a.id).sort()).toEqual([keep, copyOfMine].sort());
    // Two recipes remain, two sections each; the deleted user's children are gone.
    expect(count('section')).toBe(4);
    expect(db.select().from(user).all()).toHaveLength(1);
  });

  it('reassign: moves every recipe to the target, keeping visibility and children', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const r1 = createRecipe(db, m.id, tree());
    const r2 = createRecipe(db, m.id, tree());
    expect(deleteUser(db, m.id, { recipes: 'reassign', reassignTo: a.id })).toBe('ok');
    expect(listRecipeIdsByOwner(db, a.id).sort()).toEqual([r1, r2].sort());
    expect(getRecipeFull(db, r1)?.sections).toHaveLength(2);
    expect(db.select().from(user).all()).toHaveLength(1);
  });

  it('is atomic: a refused reassign or last-admin delete leaves recipes untouched', () => {
    setup();
    const a = mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const d = mk('d@x.test', 'member');
    deactivateUser(db, d.id);
    const rm = createRecipe(db, m.id, tree());
    const ra = createRecipe(db, a.id, tree());
    for (const reassignTo of ['nope', d.id, m.id]) {
      expect(deleteUser(db, m.id, { recipes: 'reassign', reassignTo })).toBe(
        'invalid_reassign_target',
      );
    }
    expect(deleteUser(db, a.id, { recipes: 'delete' })).toBe('last_admin');
    expect(getRecipeFull(db, rm)?.ownerId).toBe(m.id);
    expect(getRecipeFull(db, ra)?.ownerId).toBe(a.id);
    expect(count('recipe')).toBe(2);
  });

  it('deactivation does not touch recipes', () => {
    setup();
    mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    const r = createRecipe(db, m.id, tree());
    expect(deactivateUser(db, m.id)).toBe('ok');
    expect(getRecipeFull(db, r)?.ownerId).toBe(m.id);
    expect(db.select().from(recipe).all()).toHaveLength(1);
  });

  it('a user who owns recipes can no longer fail on the FK', () => {
    setup();
    mk('a@x.test', 'admin');
    const m = mk('m@x.test', 'member');
    createRecipe(db, m.id, tree());
    expect(() => deleteUser(db, m.id, { recipes: 'delete' })).not.toThrow();
  });
});

describe('deleteUserSchema', () => {
  it('requires the choice, and reassignTo only for reassign', () => {
    expect(deleteUserSchema.safeParse({ userId: 'u' }).success).toBe(false);
    expect(deleteUserSchema.safeParse({ userId: 'u', recipes: 'keep' }).success).toBe(false);
    expect(deleteUserSchema.safeParse({ userId: 'u', recipes: 'reassign' }).success).toBe(false);
    expect(deleteUserSchema.safeParse({ userId: 'u', recipes: 'delete' }).success).toBe(true);
    expect(
      deleteUserSchema.safeParse({ userId: 'u', recipes: 'reassign', reassignTo: 'v' }).success,
    ).toBe(true);
  });
});

describe('deleteUser photo files (C2)', () => {
  const tree = () => toTree(recipeInputSchema.parse(SAMPLE_VANILLA_CAKE), 'grid');
  const photoFor = (dir: string, recipeId: string, name: string) => {
    writeFileSync(join(dir, `${name}.webp`), 'x');
    writeFileSync(join(dir, `${name}-t.webp`), 'x');
    insertPhoto(db, recipeId, {
      filePath: `${name}.webp`,
      thumbPath: `${name}-t.webp`,
      width: 1,
      height: 1,
    });
  };

  it("recipes: 'delete' unlinks the owner's photo files, others and reassign keep theirs", () => {
    setup();
    const dir = mkdtempSync(join(tmpdir(), 'c2-'));
    try {
      const a = mk('a@x.test', 'admin');
      const m = mk('m@x.test', 'member');
      const n = mk('n@x.test', 'member');
      const mine = createRecipe(db, m.id, tree());
      const other = createRecipe(db, n.id, tree());
      photoFor(dir, mine, 'mine');
      photoFor(dir, other, 'other');
      expect(deleteUser(db, m.id, { recipes: 'delete' }, { uploadsDir: dir })).toBe('ok');
      expect(existsSync(join(dir, 'mine.webp'))).toBe(false);
      expect(existsSync(join(dir, 'mine-t.webp'))).toBe(false);
      expect(existsSync(join(dir, 'other.webp'))).toBe(true);
      const kept = createRecipe(db, n.id, tree());
      photoFor(dir, kept, 'kept');
      expect(
        deleteUser(db, n.id, { recipes: 'reassign', reassignTo: a.id }, { uploadsDir: dir }),
      ).toBe('ok');
      expect(existsSync(join(dir, 'kept.webp'))).toBe(true);
      expect(existsSync(join(dir, 'other.webp'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a refused delete (last admin) leaves the files alone', () => {
    setup();
    const dir = mkdtempSync(join(tmpdir(), 'c2-'));
    try {
      const a = mk('a@x.test', 'admin');
      const r = createRecipe(db, a.id, tree());
      photoFor(dir, r, 'adm');
      expect(deleteUser(db, a.id, { recipes: 'delete' }, { uploadsDir: dir })).toBe('last_admin');
      expect(existsSync(join(dir, 'adm.webp'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
