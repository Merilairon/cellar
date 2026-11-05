import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
