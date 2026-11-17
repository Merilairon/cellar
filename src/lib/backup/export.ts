import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/connection';
import { listTagsForRecipe } from '@/lib/db/tags';
import { ingredient, note, photo, rating, recipe, section, step, user } from '@/lib/db/schema';
import {
  BACKUP_VERSION,
  PHOTO_PATH_RE,
  type BackupIngredient,
  type BackupNote,
  type BackupPhoto,
  type BackupRating,
  type BackupRecipe,
  type BackupSection,
  type BackupStep,
  type BackupV1,
} from './schema';

// Serializer (T9, G13, R6, R8). Reads the DB only: no fs, no network. Redaction is by
// construction: every output field is named below, so `password_hash`, sessions, invites,
// resets, `share_token`, import jobs and ids cannot appear, and the note and rating queries
// carry the visibility predicate themselves.

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type BackupActor = { id: string; role: 'admin' | 'member' };
export type BuildOptions = {
  /** Whole-instance backup (admin only). */
  all: boolean;
  appVersion?: string;
  /** Test seam for `exported_at`. */
  now?: Date;
};

/** A non-admin asked for the whole-instance shape. The route maps this to 403. */
export class BackupForbiddenError extends Error {
  constructor() {
    super('backup_forbidden');
  }
}

/** A stored value cannot be represented in the format; refusing beats writing a bad backup. */
export class BackupExportError extends Error {}

const photoFile = (stored: string): string => {
  const p = `photos/${stored}`;
  if (!PHOTO_PATH_RE.test(p)) throw new BackupExportError('unexportable_photo_path');
  return p;
};

function loadSections(tx: Tx, recipeId: string): BackupSection[] {
  const secs = tx
    .select()
    .from(section)
    .where(eq(section.recipeId, recipeId))
    .orderBy(asc(section.position))
    .all();
  const ings = tx
    .select()
    .from(ingredient)
    .where(eq(ingredient.recipeId, recipeId))
    .orderBy(asc(ingredient.position))
    .all();
  const steps = tx
    .select()
    .from(step)
    .where(eq(step.recipeId, recipeId))
    .orderBy(asc(step.position))
    .all();
  // Split groups: stored ULIDs become per-recipe local keys g1, g2, ... by first appearance.
  const keys = new Map<string, string>();
  const keyOf = (g: string | null): string | null => {
    if (!g) return null;
    let k = keys.get(g);
    if (!k) keys.set(g, (k = `g${keys.size + 1}`));
    return k;
  };
  return secs.map((s, si) => ({
    position: si,
    title: s.title,
    ingredients: ings
      .filter((i) => i.sectionId === s.id)
      .map((i, n): BackupIngredient => ({
        position: n,
        name: i.name,
        note: i.note,
        raw_text: i.rawText,
        metric_qty: i.metricQty,
        metric_qty_max: i.metricQtyMax,
        metric_unit: i.metricUnit,
        us_qty: i.usQty,
        us_qty_max: i.usQtyMax,
        us_unit: i.usUnit,
        display_primary: i.displayPrimary,
        split_group_key: keyOf(i.splitGroupId),
        portion_label: i.portionLabel,
        group_label: i.groupLabel,
      })),
    steps: steps
      .filter((t) => t.sectionId === s.id)
      .map((t, n): BackupStep => ({
        position: n,
        kind: t.kind,
        label: t.label,
        detail: t.detail,
        row_start: t.rowStart,
        row_end: t.rowEnd,
        temp_c: t.tempC,
        temp_f: t.tempF,
        minutes_min: t.minutesMin,
        minutes_max: t.minutesMax,
      })),
  }));
}

function loadPhotos(tx: Tx, recipeId: string): BackupPhoto[] {
  return tx
    .select()
    .from(photo)
    .where(eq(photo.recipeId, recipeId))
    .orderBy(asc(photo.position), asc(photo.id))
    .all()
    .map((p, i) => ({
      position: i,
      is_cover: p.isCover,
      width: p.width,
      height: p.height,
      file: photoFile(p.filePath),
      thumb: p.thumbPath ? photoFile(p.thumbPath) : null,
    }));
}

function loadNotes(tx: Tx, recipeId: string, me: string, all: boolean): BackupNote[] {
  // The predicate is in the query: another user's private note is never selected in own scope.
  const visible = all ? sql`1 = 1` : sql`(${note.shared} = 1 OR ${note.userId} = ${me})`;
  return tx
    .select({
      body: note.body,
      shared: note.shared,
      userId: note.userId,
      name: user.displayName,
      email: user.email,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .innerJoin(user, eq(user.id, note.userId))
    .where(and(eq(note.recipeId, recipeId), visible))
    .orderBy(asc(note.createdAt), asc(note.id))
    .all()
    .map((n) => ({
      body: n.body,
      shared: n.shared,
      author_display_name: n.name,
      ...(all ? { author_email: n.email } : { mine: n.userId === me }),
      created_at: n.createdAt,
      updated_at: n.updatedAt,
    }));
}

function loadRatings(tx: Tx, recipeId: string, me: string, all: boolean): BackupRating[] {
  const rows = tx
    .select({
      stars: rating.stars,
      email: user.email,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
    })
    .from(rating)
    .innerJoin(user, eq(user.id, rating.userId))
    .where(and(eq(rating.recipeId, recipeId), all ? sql`1 = 1` : eq(rating.userId, me)))
    .orderBy(asc(user.email))
    .all();
  return rows.map((r) => ({
    stars: r.stars,
    ...(all ? { user_email: r.email } : {}),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
}

/**
 * Build the backup document. Member (`all: false`, any role): recipes with `owner_id = actor`
 * only (never `readableBy`: a `users`-visible recipe of someone else is not exported), the
 * actor's own notes plus others' shared notes (author display name only), the actor's own
 * rating. Admin `all: true`: every recipe, note and rating plus a user list without hashes.
 * One read transaction, so the document is a consistent snapshot.
 */
export function buildBackup(db: Db, actor: BackupActor, opts: BuildOptions): BackupV1 {
  if (opts.all && actor.role !== 'admin') throw new BackupForbiddenError();
  const all = opts.all;
  return db.transaction((tx) => {
    // Do not trust the caller's role claim alone: the stored role of an active user decides.
    if (all) {
      const stored = tx
        .select({ role: user.role })
        .from(user)
        .where(and(eq(user.id, actor.id), isNull(user.deactivatedAt)))
        .get();
      if (stored?.role !== 'admin') throw new BackupForbiddenError();
    }
    const rows = tx
      .select({ r: recipe, ownerEmail: user.email })
      .from(recipe)
      .innerJoin(user, eq(user.id, recipe.ownerId))
      .where(all ? sql`1 = 1` : eq(recipe.ownerId, actor.id))
      .orderBy(asc(recipe.createdAt), asc(recipe.id))
      .all();
    const recipes = rows.map(({ r, ownerEmail }): BackupRecipe => ({
      title: r.title,
      description: r.description,
      servings: r.servings,
      servings_label: r.servingsLabel,
      prep_minutes: r.prepMinutes,
      cook_minutes: r.cookMinutes,
      source_url: r.sourceUrl,
      source_name: r.sourceName,
      visibility: r.visibility,
      view_mode: r.viewMode,
      ...(all ? { owner_email: ownerEmail } : {}),
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      tags: listTagsForRecipe(tx, r.id),
      sections: loadSections(tx, r.id),
      photos: loadPhotos(tx, r.id),
      notes: loadNotes(tx, r.id, actor.id, all),
      ratings: loadRatings(tx, r.id, actor.id, all),
    }));
    return {
      version: BACKUP_VERSION,
      exported_at: (opts.now ?? new Date()).toISOString(),
      app_version: opts.appVersion ?? 'unknown',
      scope: all ? 'all' : 'own',
      ...(all
        ? {
            users: tx
              .select({
                email: user.email,
                display_name: user.displayName,
                role: user.role,
                unit_pref: user.unitPref,
                locale: user.locale,
              })
              .from(user)
              .orderBy(asc(user.email))
              .all(),
          }
        : {}),
      recipes,
    };
  });
}

/** Relative archive paths the zip must contain for this document: every file and thumb once. */
export function listBackupFiles(doc: BackupV1): string[] {
  const out = new Set<string>();
  for (const r of doc.recipes) {
    for (const p of r.photos) {
      out.add(p.file);
      if (p.thumb) out.add(p.thumb);
    }
  }
  return [...out];
}
