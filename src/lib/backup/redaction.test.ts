import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/connection';
import { insertInvite } from '@/lib/db/invites';
import { createImportJob, updateImportJob } from '@/lib/db/import-jobs';
import { insertPasswordReset } from '@/lib/db/password-resets';
import { setShareToken } from '@/lib/db/recipes';
import { insertSession } from '@/lib/db/sessions';
import { buildBackup } from './export';
import {
  addNote,
  addPhotos,
  addRating,
  memDb,
  mkUser,
  saveInput,
  SAMPLE_INPUTS,
} from './test-fixtures';

// R8: nothing secret leaves in a backup. Every canary below is a distinctive string seeded
// into a table that must never be exported (or into a row a member must not see); the
// serialized JSON must not contain any of them. A canary that is not present in the DB
// proves nothing, so the setup asserts they were really stored.

let db: Db;
afterEach(() => db.$client.close());

const C = {
  annHash: '$argon2id$v=19$m=19456,t=2,p=1$CANARY_ANN_HASH_0001',
  bobHash: '$argon2id$v=19$m=19456,t=2,p=1$CANARY_BOB_HASH_0002',
  adminHash: '$argon2id$v=19$m=19456,t=2,p=1$CANARY_ADMIN_HASH_0003',
  sessionAnn: 'canary-session-id-ann-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sessionBob: 'canary-session-id-bob-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  inviteHash: 'canary-invite-token-hash-cccccccccccccccccccccccccccccccc',
  resetHash: 'canary-reset-token-hash-dddddddddddddddddddddddddddddddd',
  shareToken: 'CANARYSHARETOKENEEEEEEEEEEEEEEE',
  rawHtmlPath: '/data/raw-html/canary-raw-0123456789.html',
  importUrl: 'https://canary-import.example.test/secret-source',
  importDraft: 'CANARY_IMPORT_DRAFT_JSON',
  bobPrivateNote: 'CANARY bob private note body',
  annPrivateNote: 'CANARY ann private note body',
};

function seed() {
  db = memDb();
  const admin = mkUser(db, 'admin@x.test', 'admin', C.adminHash);
  const ann = mkUser(db, 'ann@x.test', 'member', C.annHash);
  const bob = mkUser(db, 'bob@x.test', 'member', C.bobHash);

  const annRecipe = saveInput(db, ann.id, {
    ...SAMPLE_INPUTS[0],
    title: 'Ann recipe',
    visibility: 'users',
  });
  const bobRecipe = saveInput(db, bob.id, {
    ...SAMPLE_INPUTS[1],
    title: 'Bob recipe',
    visibility: 'users',
  });
  addPhotos(db, annRecipe, 1);

  addNote(db, annRecipe, ann.id, C.annPrivateNote, false);
  addNote(db, annRecipe, ann.id, 'ann shared note', true);
  addNote(db, annRecipe, bob.id, C.bobPrivateNote, false);
  addNote(db, annRecipe, bob.id, 'bob shared note on ann recipe', true);
  addNote(db, bobRecipe, bob.id, C.bobPrivateNote + ' 2', false);
  addRating(db, annRecipe, ann.id, 4);
  addRating(db, annRecipe, bob.id, 2);
  addRating(db, bobRecipe, bob.id, 1);

  const exp = new Date(Date.now() + 3_600_000).toISOString();
  insertSession(db, { id: C.sessionAnn, userId: ann.id, expiresAt: exp });
  insertSession(db, { id: C.sessionBob, userId: bob.id, expiresAt: exp });
  insertInvite(db, {
    tokenHash: C.inviteHash,
    email: 'new@x.test',
    createdBy: admin.id,
    expiresAt: exp,
  });
  insertPasswordReset(
    db,
    { userId: ann.id, tokenHash: C.resetHash, createdBy: admin.id, expiresAt: exp },
    new Date(),
  );
  setShareToken(db, annRecipe, C.shareToken);
  setShareToken(db, bobRecipe, C.shareToken + 'BOB');
  const job = createImportJob(db, ann.id, { url: C.importUrl, method: 'static' });
  updateImportJob(db, job.id, { rawHtmlPath: C.rawHtmlPath, draftJson: C.importDraft });
  return { admin, ann, bob };
}

const NEVER_IN_ANY_EXPORT = [
  C.annHash,
  C.bobHash,
  C.adminHash,
  'CANARY_ANN_HASH',
  'argon2id',
  C.sessionAnn,
  C.sessionBob,
  'canary-session-id',
  C.inviteHash,
  C.resetHash,
  C.shareToken,
  'CANARYSHARETOKEN',
  C.rawHtmlPath,
  'raw-html',
  C.importUrl,
  C.importDraft,
  'password_hash',
  'share_token',
  'token_hash',
  'raw_html_path',
];

describe('R8 redaction', () => {
  it('the canaries really are stored (the test can fail)', () => {
    seed();
    const dump = (t: string) => JSON.stringify(db.$client.prepare(`select * from ${t}`).all());
    expect(dump('user')).toContain(C.annHash);
    expect(dump('session')).toContain(C.sessionAnn);
    expect(dump('invite')).toContain(C.inviteHash);
    expect(dump('password_reset')).toContain(C.resetHash);
    expect(dump('recipe')).toContain(C.shareToken);
    expect(dump('import_job')).toContain(C.rawHtmlPath);
    expect(dump('note')).toContain(C.bobPrivateNote);
  });

  it('member export (ann) contains none of the secrets, nor bob private note or bob rating', () => {
    const { ann } = seed();
    const json = JSON.stringify(buildBackup(db, ann, { all: false }));
    for (const s of NEVER_IN_ANY_EXPORT) expect(json, s).not.toContain(s);
    expect(json).not.toContain(C.bobPrivateNote);
    expect(json).not.toContain('Bob recipe');
    // Positive controls: what is allowed is there.
    expect(json).toContain(C.annPrivateNote);
    expect(json).toContain('bob shared note on ann recipe');
    expect(json).toContain('Name of bob'); // author display name of a shared note
    expect(json).not.toContain('bob@x.test'); // no other user's email in own scope
    const doc = buildBackup(db, ann, { all: false });
    expect(doc.recipes).toHaveLength(1);
    expect(doc.recipes[0].ratings).toHaveLength(1);
    expect(doc.recipes[0].ratings[0].stars).toBe(4);
    expect(JSON.stringify(doc.recipes[0].ratings)).not.toMatch(/user|email/);
  });

  it("member export (bob) does not carry ann's private note or ann's rating", () => {
    const { bob } = seed();
    const doc = buildBackup(db, bob, { all: false });
    const json = JSON.stringify(doc);
    for (const s of NEVER_IN_ANY_EXPORT) expect(json, s).not.toContain(s);
    expect(json).not.toContain(C.annPrivateNote);
    expect(json).not.toContain('ann@x.test');
    expect(doc.recipes).toHaveLength(1);
    expect(doc.recipes[0].ratings.map((r) => r.stars)).toEqual([1]);
  });

  it('admin all export: whole instance, but no hash, session, token, share token or import data', () => {
    const { admin } = seed();
    const doc = buildBackup(db, admin, { all: true });
    const json = JSON.stringify(doc);
    for (const s of NEVER_IN_ANY_EXPORT) expect(json, s).not.toContain(s);
    // Documented whole-instance content is present.
    expect(json).toContain(C.bobPrivateNote);
    expect(json).toContain('bob@x.test');
    expect(doc.users).toHaveLength(3);
    expect(Object.keys(doc.users![0]).sort()).toEqual([
      'display_name',
      'email',
      'locale',
      'role',
      'unit_pref',
    ]);
  });

  it('admin acting as a member (all: false) sees no one elses private data', () => {
    const { admin } = seed();
    const json = JSON.stringify(buildBackup(db, admin, { all: false }));
    for (const s of NEVER_IN_ANY_EXPORT) expect(json, s).not.toContain(s);
    expect(json).not.toContain(C.bobPrivateNote);
    expect(json).not.toContain(C.annPrivateNote);
  });

  it('no stored id value appears anywhere in any export (values, not only key names)', () => {
    const { admin, ann, bob } = seed();
    const tables = [
      'user',
      'recipe',
      'note',
      'section',
      'ingredient',
      'step',
      'photo',
      'tag',
      'session',
      'invite',
      'password_reset',
      'import_job',
    ];
    const ids = tables.flatMap((t) =>
      (db.$client.prepare(`select id from ${t}`).all() as Array<{ id: string }>).map((r) => r.id),
    );
    expect(ids.length).toBeGreaterThan(50);
    for (const actor of [ann, bob]) {
      const json = JSON.stringify(buildBackup(db, actor, { all: false }));
      for (const id of ids) expect(json.includes(id), id).toBe(false);
    }
    const all = JSON.stringify(buildBackup(db, admin, { all: true }));
    for (const id of ids) expect(all.includes(id), id).toBe(false);
  });

  it('other secrets-adjacent columns stay out: deactivated_at, copied_from, invite email, import ids', () => {
    const { admin, ann, bob } = seed();
    db.$client
      .prepare('update user set deactivated_at = ? where id = ?')
      .run('2031-02-03T04:05:06.789Z', bob.id);
    const src = db.$client
      .prepare('select id from recipe where owner_id = ? limit 1')
      .get(ann.id) as { id: string };
    db.$client
      .prepare('update recipe set copied_from_id = ? where owner_id = ?')
      .run(src.id, bob.id);
    for (const actor of [ann, admin]) {
      const json = JSON.stringify(buildBackup(db, actor, { all: actor === admin }));
      expect(json).not.toContain('2031-02-03');
      expect(json).not.toContain('deactivated');
      expect(json).not.toContain('copied_from');
      expect(json).not.toContain('new@x.test'); // invite email
    }
  });

  it('exact key allowlist per object type (a new column cannot join an export unnoticed)', () => {
    const { admin, ann } = seed();
    const ownDoc = buildBackup(db, ann, { all: false });
    const allDoc = buildBackup(db, admin, { all: true });
    const keys = (o: object) => Object.keys(o).sort();
    const recipeKeys = [
      'cook_minutes',
      'created_at',
      'description',
      'notes',
      'photos',
      'prep_minutes',
      'ratings',
      'sections',
      'servings',
      'servings_label',
      'source_name',
      'source_url',
      'tags',
      'title',
      'updated_at',
      'view_mode',
      'visibility',
    ];
    expect(keys(ownDoc)).toEqual(['app_version', 'exported_at', 'recipes', 'scope', 'version']);
    expect(keys(allDoc)).toEqual([
      'app_version',
      'exported_at',
      'recipes',
      'scope',
      'users',
      'version',
    ]);
    expect(keys(ownDoc.recipes[0])).toEqual(recipeKeys);
    expect(keys(allDoc.recipes[0])).toEqual([...recipeKeys, 'owner_email'].sort());
    const sec = ownDoc.recipes[0].sections[0];
    expect(keys(sec)).toEqual(['ingredients', 'position', 'steps', 'title']);
    expect(keys(sec.ingredients[0])).toEqual([
      'display_primary',
      'group_label',
      'metric_qty',
      'metric_qty_max',
      'metric_unit',
      'name',
      'note',
      'portion_label',
      'position',
      'raw_text',
      'split_group_key',
      'us_qty',
      'us_qty_max',
      'us_unit',
    ]);
    expect(keys(sec.steps[0])).toEqual([
      'detail',
      'kind',
      'label',
      'minutes_max',
      'minutes_min',
      'position',
      'row_end',
      'row_start',
      'temp_c',
      'temp_f',
    ]);
    expect(keys(ownDoc.recipes[0].photos[0])).toEqual([
      'file',
      'height',
      'is_cover',
      'position',
      'thumb',
      'width',
    ]);
    expect(keys(ownDoc.recipes[0].notes[0])).toEqual([
      'author_display_name',
      'body',
      'created_at',
      'mine',
      'shared',
      'updated_at',
    ]);
    expect(keys(ownDoc.recipes[0].ratings[0])).toEqual(['created_at', 'stars', 'updated_at']);
    const aRecipe = allDoc.recipes.find((r) => r.notes.length > 0)!;
    expect(keys(aRecipe.notes[0])).toEqual([
      'author_display_name',
      'author_email',
      'body',
      'created_at',
      'shared',
      'updated_at',
    ]);
    expect(keys(aRecipe.ratings[0])).toEqual(['created_at', 'stars', 'updated_at', 'user_email']);
  });

  it('seeded rows exist for every exclusion claim (no vacuous passes)', () => {
    seed();
    const n = (sql: string) => (db.$client.prepare(sql).get() as { n: number }).n;
    expect(
      n(
        "select count(*) n from note where shared = 0 and user_id = (select id from user where email='bob@x.test')",
      ),
    ).toBe(2);
    expect(
      n(
        "select count(*) n from rating where user_id = (select id from user where email='bob@x.test') and recipe_id in (select id from recipe where title='Ann recipe')",
      ),
    ).toBe(1);
    expect(n('select count(*) n from recipe where share_token is not null')).toBe(2);
    expect(n('select count(*) n from session')).toBe(2);
  });

  it("bob's other private note never appears in ann's export", () => {
    const { ann } = seed();
    expect(JSON.stringify(buildBackup(db, ann, { all: false }))).not.toContain(
      C.bobPrivateNote + ' 2',
    );
  });

  it('negative control: a serializer that leaks a column is caught by the same checks', () => {
    const { ann } = seed();
    const leak = (doc: object) => JSON.stringify(doc);
    const doc = buildBackup(db, ann, { all: false });
    const leaked = {
      ...doc,
      recipes: doc.recipes.map((r) => ({ ...r, share_token: C.shareToken })),
    };
    const hit = (json: string) => NEVER_IN_ANY_EXPORT.filter((x) => json.includes(x));
    expect(hit(leak(doc))).toEqual([]);
    expect(hit(leak(leaked)).length).toBeGreaterThan(0);
  });
});
