import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { ulid } from 'ulid';

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
