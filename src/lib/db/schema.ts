import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { ulid } from 'ulid';
import { IMPORT_ERROR_CODES } from '../import/errors';

/** ISO-8601 UTC timestamp, the storage format for every timestamp column. */
export const nowIso = (): string => new Date().toISOString();

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => ulid());
const createdAt = () =>
  text('created_at')
    .notNull()
    .$defaultFn(() => nowIso());

export const user = sqliteTable('user', {
  id: id(),
  email: text('email').notNull().unique(), // stored lowercased by the caller
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(), // argon2id PHC string
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  unitPref: text('unit_pref', { enum: ['metric', 'us'] })
    .notNull()
    .default('metric'),
  locale: text('locale').notNull().default('en'),
  createdAt: createdAt(),
  deactivatedAt: text('deactivated_at'),
});

export const session = sqliteTable(
  'session',
  {
    // SHA-256 hex of the random cookie token, not a ULID.
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('session_user_id_idx').on(t.userId),
    index('session_expires_at_idx').on(t.expiresAt),
  ],
);

export const invite = sqliteTable('invite', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email'),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
});

export const passwordReset = sqliteTable('password_reset', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: createdAt(),
});

export const recipe = sqliteTable(
  'recipe',
  {
    id: id(),
    // No cascade: a user delete must handle recipes explicitly (reassign or delete).
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    servings: real('servings'),
    servingsLabel: text('servings_label'),
    prepMinutes: integer('prep_minutes'),
    cookMinutes: integer('cook_minutes'),
    sourceUrl: text('source_url'),
    sourceName: text('source_name'),
    visibility: text('visibility', { enum: ['private', 'users'] })
      .notNull()
      .default('private'),
    // Unused until M5; present so M5 needs no table rebuild.
    shareToken: text('share_token').unique(),
    copiedFromId: text('copied_from_id').references((): AnySQLiteColumn => recipe.id, {
      onDelete: 'set null',
    }),
    viewMode: text('view_mode', { enum: ['grid', 'list'] })
      .notNull()
      .default('list'),
    createdAt: createdAt(),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => nowIso()),
  },
  (t) => [
    index('recipe_owner_id_idx').on(t.ownerId),
    // Makes ON DELETE SET NULL on copied_from_id an index lookup, not a table scan.
    index('recipe_copied_from_id_idx').on(t.copiedFromId),
    index('recipe_visibility_updated_at_idx').on(t.visibility, t.updatedAt),
    // Duplicate detection on import (normalized source url lookup).
    index('recipe_source_url_idx').on(t.sourceUrl),
    check('recipe_visibility_chk', sql`${t.visibility} IN ('private', 'users')`),
    check('recipe_view_mode_chk', sql`${t.viewMode} IN ('grid', 'list')`),
  ],
);

export const section = sqliteTable(
  'section',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title'),
  },
  (t) => [uniqueIndex('section_recipe_position_uq').on(t.recipeId, t.position)],
);

export const ingredient = sqliteTable(
  'ingredient',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    // Plain ULID shared by the rows of one ingredient; no table, no FK.
    splitGroupId: text('split_group_id'),
    portionLabel: text('portion_label'),
    name: text('name').notNull(),
    note: text('note'),
    rawText: text('raw_text').notNull(),
    metricQty: real('metric_qty'),
    // Upper bound of a range ("2-3 tbsp"); null for a single quantity.
    metricQtyMax: real('metric_qty_max'),
    metricUnit: text('metric_unit'),
    usQty: real('us_qty'),
    usQtyMax: real('us_qty_max'),
    usUnit: text('us_unit'),
    displayPrimary: text('display_primary', { enum: ['metric', 'us'] })
      .notNull()
      .default('metric'),
    groupLabel: text('group_label'),
  },
  (t) => [
    uniqueIndex('ingredient_section_position_uq').on(t.sectionId, t.position),
    index('ingredient_recipe_id_idx').on(t.recipeId),
    check('ingredient_display_primary_chk', sql`${t.displayPrimary} IN ('metric', 'us')`),
  ],
);

export const step = sqliteTable(
  'step',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: ['banner_top', 'column', 'banner_bottom'] }).notNull(),
    label: text('label').notNull(),
    detail: text('detail').notNull().default(''),
    rowStart: integer('row_start'),
    rowEnd: integer('row_end'),
    tempC: integer('temp_c'),
    tempF: integer('temp_f'),
    minutesMin: integer('minutes_min'),
    minutesMax: integer('minutes_max'),
  },
  (t) => [
    uniqueIndex('step_section_position_uq').on(t.sectionId, t.position),
    index('step_recipe_id_idx').on(t.recipeId),
    check('step_kind_chk', sql`${t.kind} IN ('banner_top', 'column', 'banner_bottom')`),
    // Banners never carry spans. Column spans are both null (list-mode recipe) or both set
    // with 0 <= row_start <= row_end. Range against the ingredient count is validated in
    // src/lib/grid/validate.ts.
    check(
      'step_span_chk',
      sql`(${t.kind} IN ('banner_top', 'banner_bottom') AND ${t.rowStart} IS NULL AND ${t.rowEnd} IS NULL) OR (${t.kind} = 'column' AND ((${t.rowStart} IS NULL AND ${t.rowEnd} IS NULL) OR (${t.rowStart} IS NOT NULL AND ${t.rowEnd} IS NOT NULL AND ${t.rowStart} >= 0 AND ${t.rowStart} <= ${t.rowEnd})))`,
    ),
  ],
);

export const IMPORT_STATUSES = [
  'queued',
  'fetching',
  'parsed',
  'needs_review',
  'failed',
  'saved',
] as const;
export const IMPORT_METHODS = ['static', 'headless', 'paste'] as const;
export const IMPORT_ERROR_CODE_VALUES = IMPORT_ERROR_CODES;

const sqlList = (vals: readonly string[]) => sql.raw(vals.map((v) => `'${v}'`).join(', '));

export const importJob = sqliteTable(
  'import_job',
  {
    id: id(),
    // Drafts are disposable, so they go with the user. The saved recipe is protected
    // separately (recipe.owner_id is RESTRICT).
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    url: text('url'), // null for paste jobs
    status: text('status', { enum: IMPORT_STATUSES }).notNull().default('queued'),
    method: text('method', { enum: IMPORT_METHODS }),
    errorCode: text('error_code', { enum: IMPORT_ERROR_CODE_VALUES }),
    rawHtmlPath: text('raw_html_path'), // only set when KEEP_RAW_HTML is on
    draftJson: text('draft_json'),
    recipeId: text('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => nowIso()),
  },
  (t) => [
    index('import_job_user_created_idx').on(t.userId, t.createdAt),
    index('import_job_recipe_id_idx').on(t.recipeId),
    check('import_job_status_chk', sql`${t.status} IN (${sqlList(IMPORT_STATUSES)})`),
    check(
      'import_job_method_chk',
      sql`${t.method} IS NULL OR ${t.method} IN (${sqlList(IMPORT_METHODS)})`,
    ),
    check(
      'import_job_error_code_chk',
      sql`${t.errorCode} IS NULL OR ${t.errorCode} IN (${sqlList(IMPORT_ERROR_CODE_VALUES)})`,
    ),
  ],
);

export const photo = sqliteTable(
  'photo',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    // Relative to the uploads dir, generated by the server (<ulid>.webp), never user-supplied.
    filePath: text('file_path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    // Relative to the uploads dir (<ulid>.webp). NULL for rows that predate 0007: serve the full image.
    thumbPath: text('thumb_path'),
    position: integer('position').notNull().default(0),
    isCover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('photo_recipe_id_idx').on(t.recipeId),
    // At most one cover per recipe.
    uniqueIndex('photo_one_cover_uq')
      .on(t.recipeId)
      .where(sql`${t.isCover} = 1`),
    check('photo_is_cover_chk', sql`${t.isCover} IN (0, 1)`),
  ],
);

/** Max tags on one recipe (owner decision Q7); also enforced by a trigger in migration 0005. */
export const MAX_TAGS_PER_RECIPE = 20;
export const MAX_TAG_LENGTH = 40;

/**
 * Tag names are stored normalized by the service layer (trim, collapse whitespace, NFC,
 * lowercase); `name` is unique on that form. The length CHECK is the DB backstop.
 */
export const tag = sqliteTable(
  'tag',
  {
    id: id(),
    name: text('name').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [check('tag_name_len_chk', sql`length(${t.name}) BETWEEN 1 AND 40`)],
);

export const recipeTag = sqliteTable(
  'recipe_tag',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.tagId] }),
    index('recipe_tag_tag_id_idx').on(t.tagId),
  ],
);

/** Max length of a note body (DB backstop; the service validates first). */
export const MAX_NOTE_LENGTH = 4000;

/**
 * Per-user note on a recipe; `shared = 1` makes it visible to everyone who can read the recipe.
 * Keyed by recipe_id only (recipe ids of children change on every save, the recipe id does not).
 * Deleting the recipe or the author deletes the note (owner decision Q14).
 */
export const note = sqliteTable(
  'note',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => nowIso()),
  },
  (t) => [
    index('note_recipe_id_idx').on(t.recipeId),
    index('note_user_id_idx').on(t.userId),
    check('note_body_len_chk', sql`length(${t.body}) BETWEEN 1 AND 4000`),
    check('note_shared_chk', sql`${t.shared} IN (0, 1)`),
  ],
);

/** One star rating (1..5) per user and recipe. */
export const rating = sqliteTable(
  'rating',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    createdAt: createdAt(),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => nowIso()),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.userId] }),
    index('rating_recipe_id_idx').on(t.recipeId),
    check('rating_stars_chk', sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);

// `recipe_fts` (FTS5 virtual table) and its sync triggers exist only in the hand-written
// migration 0005_search_tags.sql; drizzle-kit cannot model them. Same for `note_fts` and its
// triggers in 0007.
