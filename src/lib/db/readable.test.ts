import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { canView, type Actor } from '@/lib/recipes/access';
import { openDb, type Db } from './connection';
import { runMigrations } from './migrate';
import { readableBy } from './readable';
import { recipe, user } from './schema';
import { listRecipeIdsByOwner } from './test-helpers';

// G2 agreement test: `readableBy(userId)` is the SQL twin of `canView(actor, row)` for a
// signed-in actor without a share token. Every (actor, visibility) pair goes through both and
// must produce the same set of recipe ids, except the one documented asymmetry asserted below.

let db: Db;
afterEach(() => db?.$client.close());

const visibilities = ['private', 'users'] as const;
type Vis = (typeof visibilities)[number];
const TOKEN = 't'.repeat(32);

function seed() {
  db = openDb(':memory:');
  runMigrations(db);
  const mk = (email: string, role: 'admin' | 'member' = 'member') =>
    db
      .insert(user)
      .values({ email, displayName: email, passwordHash: 'h', role })
      .returning()
      .get();
  const owner = mk('o@x.test');
  const other = mk('x@x.test');
  const admin = mk('a@x.test', 'admin');
  // Every user owns one private and one users-visible recipe, so each actor is "owner" of some
  // rows and "other member" of the rest. One private row also carries a share token: a stored
  // token must change nothing for signed-in list or by-id reads.
  for (const u of [owner, other, admin]) {
    for (const visibility of visibilities) {
      db.insert(recipe)
        .values({ ownerId: u.id, title: `${u.email} ${visibility}`, visibility })
        .run();
    }
  }
  db.insert(recipe)
    .values({ ownerId: owner.id, title: 'tokened', visibility: 'private', shareToken: TOKEN })
    .run();
  return { owner, other, admin };
}

const allRows = () => db.select().from(recipe).all();
const viewSet = (actor: Actor, visibility: Vis) =>
  new Set(
    allRows()
      .filter((r) => r.visibility === visibility && canView(actor, r))
      .map((r) => r.id),
  );
const sqlSet = (userId: string, visibility: Vis) =>
  new Set(
    db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(readableBy(userId), eq(recipe.visibility, visibility)))
      .all()
      .map((r) => r.id),
  );

describe('readableBy agrees with canView', () => {
  it.each([
    ['owner', 'private'],
    ['owner', 'users'],
    ['other member', 'private'],
    ['other member', 'users'],
  ] as const)('member actor (%s) x %s: same set through SQL and the helper', (who, visibility) => {
    const users = seed();
    const actor = who === 'owner' ? users.owner : users.other;
    const viaHelper = viewSet(actor, visibility);
    const viaSql = sqlSet(actor.id, visibility);
    expect(viaSql).toEqual(viaHelper);
    // Sanity: the set is what the rule says, not accidentally empty.
    const expected =
      visibility === 'users'
        ? allRows().filter((r) => r.visibility === 'users').length
        : listRecipeIdsByOwner(db, actor.id).length - 1; // minus the owner's `users` row
    expect(viaHelper.size).toBe(expected);
    expect(viaHelper.size).toBeGreaterThan(0);
  });

  it('admin x users: same set through SQL and the helper', () => {
    const { admin } = seed();
    expect(sqlSet(admin.id, 'users')).toEqual(viewSet(admin, 'users'));
    expect(viewSet(admin, 'users').size).toBe(3);
  });

  it('admin x private: the documented by-id asymmetry (carryover item 12)', () => {
    // An admin may read any private recipe by id (`canView` true: edit, delete, repair) but
    // lists, search and tags never show other users' private recipes (`readableBy` false).
    // This is deliberate and recorded in docs/tasks/v0.4.2-carryover.md item 12 and the v1.0
    // tasklist (finding 2, G2). If either side changes, this test must change with it.
    const { admin } = seed();
    const viaHelper = viewSet(admin, 'private');
    const viaSql = sqlSet(admin.id, 'private');
    const ownPrivate = new Set(
      allRows()
        .filter((r) => r.ownerId === admin.id && r.visibility === 'private')
        .map((r) => r.id),
    );
    const allPrivate = new Set(
      allRows()
        .filter((r) => r.visibility === 'private')
        .map((r) => r.id),
    );
    expect(viaSql).toEqual(ownPrivate);
    expect(viaHelper).toEqual(allPrivate);
    expect(viaHelper.size).toBeGreaterThan(viaSql.size);
    for (const id of viaSql) expect(viaHelper.has(id)).toBe(true);
    const onlyById = [...viaHelper].filter((id) => !viaSql.has(id));
    expect(onlyById).toHaveLength(allPrivate.size - ownPrivate.size);
    expect(onlyById.every((id) => !listRecipeIdsByOwner(db, admin.id).includes(id))).toBe(true);
  });

  it('a stored share token changes nothing for signed-in actors on either side', () => {
    const { owner, other, admin } = seed();
    const tokened = allRows().find((r) => r.shareToken === TOKEN)!;
    expect(canView(other, tokened)).toBe(false);
    expect(sqlSet(other.id, 'private').has(tokened.id)).toBe(false);
    expect(canView(owner, tokened)).toBe(true);
    expect(sqlSet(owner.id, 'private').has(tokened.id)).toBe(true);
    expect(canView(admin, tokened)).toBe(true);
    expect(sqlSet(admin.id, 'private').has(tokened.id)).toBe(false); // the asymmetry again
  });

  it('anonymous has no list form: canView(null, row) is false for every seeded row without a token', () => {
    seed();
    const rows = allRows();
    expect(rows.length).toBe(7);
    for (const r of rows) {
      expect(canView(null, r)).toBe(false);
      expect(canView(null, r, { publicLinksEnabled: true })).toBe(false);
    }
    // The only anonymous path is the one tokened row, with its token, one recipe at a time.
    const hits = rows.filter((r) => canView(null, r, { token: TOKEN, publicLinksEnabled: true }));
    expect(hits.map((r) => r.title)).toEqual(['tokened']);
  });
});
