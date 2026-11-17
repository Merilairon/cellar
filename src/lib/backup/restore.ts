import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inArray, isNull } from 'drizzle-orm';
import { monotonicFactory, ulid } from 'ulid';
import type { Db } from '@/lib/db/connection';
import { insertRecipeTree, type RecipeTree } from '@/lib/db/recipes';
import { setCover } from '@/lib/db/photos';
import { note, photo, rating, recipe, user } from '@/lib/db/schema';
import { validateRecipeGrid } from '@/lib/grid/validate';
import { processImage } from '@/lib/images/process';
import { LimiterBusyError, limitDecode } from '@/lib/import/limiter';
import type { BackupRecipe, BackupV1 } from './schema';
import { backupRecipeToTree } from './toTree';
import type { OpenedZip } from './unzip';
import { errCode, log } from '@/lib/log';

// Restore planning and apply (T11, G15 to G17). Owner and author identity never come from the
// file's own claims about who is allowed to do what: a member restore targets the caller for
// everything; an admin `all` restore maps emails to EXISTING ACTIVE users only. No user is ever
// created and no role is ever granted (`users[].role` is not read).

export type RestoreActor = { id: string; role: 'admin' | 'member' };
export type Strategy = 'skip' | 'rename';
/** Where photo files come from: an opened archive, or nothing (a JSON backup has no photos). */
export type PhotoSource = Pick<OpenedZip, 'has' | 'read'>;

/** A member tried to restore a `scope: 'all'` document. The route maps this to 403. */
export class RestoreForbiddenError extends Error {
  constructor() {
    super('restore_forbidden');
  }
}

export type RestorePreview = {
  scope: 'own' | 'all';
  recipes: number;
  sections: number;
  ingredients: number;
  /** Notes that would be restored (not counting `notes_skipped`). */
  notes: number;
  /** Ratings that would be restored (not counting `ratings_skipped`). */
  ratings: number;
  /** Photo files that would be restored: 0 for a JSON backup. */
  photos: number;
  conflicts: Array<{ title: string; reason: 'same_title' }>;
  unknown_users: string[];
  notes_skipped: number;
  ratings_skipped: number;
};

export type ApplyResult = {
  imported: number;
  skipped: number;
  renamed: number;
  notes_restored: number;
  notes_skipped: number;
  ratings_restored: number;
  ratings_skipped: number;
  photos_restored: number;
  photos_failed: number;
  failed_at: number | null;
};

/** Trim, NFC, case-fold: the comparison key of "same title" (G16). */
export const normalizeTitle = (t: string): string => t.trim().normalize('NFC').toLowerCase();

const MAX_TITLE = 200;

/** "Title (restored)", then "(restored 2)", ...; the base is cut so the result fits a title. */
export function renamedTitle(title: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (restored)' : ` (restored ${n})`;
    const base = [...title].slice(0, MAX_TITLE - suffix.length).join('');
    const candidate = `${base}${suffix}`;
    if (!taken.has(normalizeTitle(candidate))) return candidate;
  }
}

type Plan = {
  ownerOf(r: BackupRecipe): string;
  noteUser(r: BackupRecipe, n: BackupRecipe['notes'][number]): string | null;
  ratingUser(x: BackupRecipe['ratings'][number]): string | null;
  unknownOwners: string[];
  /** normalized titles per target owner, as stored before the restore */
  existing: Map<string, Set<string>>;
};

function plan(db: Db, actor: RestoreActor, doc: BackupV1): Plan {
  if (doc.scope === 'all' && actor.role !== 'admin') throw new RestoreForbiddenError();
  let emailToId = new Map<string, string>();
  const unknown = new Set<string>();
  if (doc.scope === 'all') {
    // Active users only: a deactivated account must not receive recipes it cannot see.
    emailToId = new Map(
      db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(isNull(user.deactivatedAt))
        .all()
        .map((u) => [u.email, u.id]),
    );
    for (const r of doc.recipes) {
      if (r.owner_email !== undefined && !emailToId.has(r.owner_email)) unknown.add(r.owner_email);
    }
  }
  const ownerOf = (r: BackupRecipe): string =>
    doc.scope === 'all' && r.owner_email !== undefined
      ? (emailToId.get(r.owner_email) ?? actor.id)
      : actor.id;
  const owners = new Set(doc.recipes.map(ownerOf));
  const existing = new Map<string, Set<string>>([...owners].map((o) => [o, new Set<string>()]));
  if (owners.size > 0) {
    const rows = db
      .select({ ownerId: recipe.ownerId, title: recipe.title })
      .from(recipe)
      .where(inArray(recipe.ownerId, [...owners]))
      .all();
    for (const row of rows) existing.get(row.ownerId)!.add(normalizeTitle(row.title));
  }
  return {
    ownerOf,
    noteUser: (_r, n) =>
      doc.scope === 'all'
        ? n.author_email !== undefined
          ? (emailToId.get(n.author_email) ?? null)
          : null
        : n.mine === true
          ? actor.id
          : null,
    ratingUser: (x) =>
      doc.scope === 'all'
        ? x.user_email !== undefined
          ? (emailToId.get(x.user_email) ?? null)
          : null
        : actor.id,
    unknownOwners: [...unknown].sort(),
    existing,
  };
}

/** Read-only: counts, conflicts and unknown owners. Never writes. */
export function previewRestore(
  db: Db,
  actor: RestoreActor,
  doc: BackupV1,
  photos: Pick<PhotoSource, 'has'> | null,
): RestorePreview {
  const p = plan(db, actor, doc);
  const out: RestorePreview = {
    scope: doc.scope,
    recipes: doc.recipes.length,
    sections: 0,
    ingredients: 0,
    notes: 0,
    ratings: 0,
    photos: 0,
    conflicts: [],
    unknown_users: p.unknownOwners,
    notes_skipped: 0,
    ratings_skipped: 0,
  };
  for (const r of doc.recipes) {
    out.sections += r.sections.length;
    for (const s of r.sections) out.ingredients += s.ingredients.length;
    for (const n of r.notes) {
      if (p.noteUser(r, n) === null) out.notes_skipped++;
      else out.notes++;
    }
    for (const x of r.ratings) {
      if (p.ratingUser(x) === null) out.ratings_skipped++;
      else out.ratings++;
    }
    if (photos) for (const ph of r.photos) if (photos.has(ph.file)) out.photos++;
    if (p.existing.get(p.ownerOf(r))!.has(normalizeTitle(r.title))) {
      out.conflicts.push({ title: r.title, reason: 'same_title' });
    }
  }
  return out;
}

function gridFailure(tree: RecipeTree): boolean {
  if (tree.fields.viewMode !== 'grid') return false;
  return (
    validateRecipeGrid({
      sections: tree.sections.map((s) => ({
        ingredients: s.ingredients.map((i) => ({ split_group_id: i.splitGroupId ?? null })),
        steps: s.steps.map((t) => ({
          kind: t.kind,
          row_start: t.rowStart ?? null,
          row_end: t.rowEnd ?? null,
        })),
      })),
    }).errors.length > 0
  );
}

export type ApplyDeps = {
  /** Seam: the decode limiter (defaults to the process-wide one shared with uploads). */
  decode?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Seam: insert one photo row (defaults to a plain insert). */
  insertPhotoRow?: (row: typeof photo.$inferInsert) => void;
  /** Seam: pause between decode retries when the limiter is busy. */
  sleep?: (ms: number) => Promise<void>;
  /** Seam: photo budget per apply (defaults to MAX_RESTORE_PHOTOS). Tests only. */
  maxPhotos?: number;
};

const yieldToEventLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

const DECODE_RETRIES = 3;
/** Photos decoded per restore: bounds how long one apply holds the process-wide slot (AppSec M2). */
export const MAX_RESTORE_PHOTOS = 2000;

async function storePhoto(
  db: Db,
  recipeId: string,
  entry: Buffer,
  meta: { position: number; isCover: boolean },
  uploadsDir: string,
  deps: ApplyDeps,
): Promise<string> {
  const decode = deps.decode ?? limitDecode;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let processed;
  for (let attempt = 0; ; attempt++) {
    try {
      processed = await decode(() => processImage(entry, { allowed: ['jpeg', 'png', 'webp'] }));
      break;
    } catch (e) {
      if (!(e instanceof LimiterBusyError) || attempt >= DECODE_RETRIES) throw e;
      await sleep(500);
    }
  }
  if (!processed.ok) throw new Error(processed.reason);
  const photoId = ulid();
  const mainName = `${ulid()}.webp`;
  const thumbName = `${ulid()}.webp`;
  const mainAbs = join(uploadsDir, mainName);
  const thumbAbs = join(uploadsDir, thumbName);
  try {
    await mkdir(uploadsDir, { recursive: true, mode: 0o700 });
    await writeFile(mainAbs, processed.main.data, { mode: 0o600, flag: 'wx' });
    await writeFile(thumbAbs, processed.thumb.data, { mode: 0o600, flag: 'wx' });
    const row = {
      id: photoId,
      recipeId,
      filePath: mainName,
      thumbPath: thumbName,
      width: processed.main.width,
      height: processed.main.height,
      position: meta.position,
      isCover: meta.isCover,
    };
    if (deps.insertPhotoRow) deps.insertPhotoRow(row);
    else db.insert(photo).values(row).run();
  } catch (e) {
    await Promise.all([rm(mainAbs, { force: true }), rm(thumbAbs, { force: true })]);
    throw e;
  }
  return photoId;
}

/**
 * Apply a validated document. One `BEGIN IMMEDIATE` transaction per recipe (tree, tags, notes,
 * ratings); photo files are written after that recipe commits. The first recipe that cannot be
 * stored stops the run: earlier recipes stay, `failed_at` is its index in the file.
 */
export async function applyRestore(
  db: Db,
  actor: RestoreActor,
  doc: BackupV1,
  photos: PhotoSource | null,
  strategy: Strategy,
  uploadsDir: string,
  deps: ApplyDeps = {},
): Promise<ApplyResult> {
  const p = plan(db, actor, doc);
  const res: ApplyResult = {
    imported: 0,
    skipped: 0,
    renamed: 0,
    notes_restored: 0,
    notes_skipped: 0,
    ratings_restored: 0,
    ratings_skipped: 0,
    photos_restored: 0,
    photos_failed: 0,
    failed_at: null,
  };
  // Titles taken so far per owner (stored ones plus what this run added): rename candidates
  // must avoid both. Conflict detection uses the titles stored BEFORE the run (`p.existing`),
  // so two same-titled recipes inside one file are restored as they were.
  const taken = new Map([...p.existing].map(([o, s]) => [o, new Set(s)]));
  let attempted = 0;
  const nextId = monotonicFactory(); // note ids keep the file order within one millisecond

  for (let k = 0; k < doc.recipes.length; k++) {
    const r = doc.recipes[k]!;
    // A skipped recipe costs almost nothing, but 5000 of them must not hold the loop either.
    if (k > 0 && k % 50 === 0) await yieldToEventLoop();
    const owner = p.ownerOf(r);
    const conflict = p.existing.get(owner)!.has(normalizeTitle(r.title));
    if (conflict && strategy === 'skip') {
      res.skipped++;
      // Notes and ratings of a skipped recipe are not restored and not counted as skipped users.
      continue;
    }
    const title = conflict ? renamedTitle(r.title, taken.get(owner)!) : r.title;
    const tree = backupRecipeToTree({ ...r, title });
    if (gridFailure(tree)) {
      res.failed_at = k;
      break;
    }
    const noteRows = r.notes.flatMap((n) => {
      const uid = p.noteUser(r, n);
      return uid === null ? [] : [{ userId: uid, body: n.body, shared: n.shared }];
    });
    const ratingRows = r.ratings.flatMap((x) => {
      const uid = p.ratingUser(x);
      return uid === null ? [] : [{ userId: uid, stars: x.stars }];
    });
    let recipeId: string;
    try {
      recipeId = db.transaction(
        (tx) => {
          const id = insertRecipeTree(tx, owner, tree);
          for (const n of noteRows) {
            tx.insert(note)
              .values({
                id: nextId(),
                recipeId: id,
                userId: n.userId,
                body: n.body,
                shared: n.shared,
              })
              .run();
          }
          for (const x of ratingRows) {
            tx.insert(rating).values({ recipeId: id, userId: x.userId, stars: x.stars }).run();
          }
          return id;
        },
        { behavior: 'immediate' },
      );
    } catch (e) {
      log('error', 'restore.recipe_failed', { index: k, code: errCode(e) });
      res.failed_at = k;
      break;
    }
    taken.get(owner)!.add(normalizeTitle(title));
    res.imported++;
    if (conflict) res.renamed++;
    res.notes_restored += noteRows.length;
    res.notes_skipped += r.notes.length - noteRows.length;
    res.ratings_restored += ratingRows.length;
    res.ratings_skipped += r.ratings.length - ratingRows.length;

    // Yield between recipes (never inside a transaction): the apply is synchronous per recipe,
    // so without this one restore freezes every other request (v1.0 security review H1).
    await yieldToEventLoop();

    if (photos) {
      const stored: string[] = [];
      let cover = false;
      for (const ph of r.photos) {
        try {
          if (attempted++ >= (deps.maxPhotos ?? MAX_RESTORE_PHOTOS))
            throw new Error('photo_budget');
          if (!photos.has(ph.file)) throw new Error('entry_missing');
          const bytes = await photos.read(ph.file);
          const isCover = ph.is_cover && !cover;
          const id = await storePhoto(
            db,
            recipeId,
            bytes,
            { position: stored.length, isCover },
            uploadsDir,
            deps,
          );
          if (isCover) cover = true;
          stored.push(id);
          res.photos_restored++;
        } catch (e) {
          log('warn', 'restore.photo_skipped', { code: errCode(e) });
          res.photos_failed++;
        }
      }
      // The cover photo itself may have been the bad one: never leave photos without a cover.
      if (stored.length > 0 && !cover) {
        try {
          setCover(db, recipeId, stored[0]!);
        } catch (e) {
          log('warn', 'restore.cover_not_set', { code: errCode(e) });
        }
      }
    }
  }
  return res;
}
