-- Hand-written (drizzle-kit cannot model FTS5 or triggers). Tables match schema.ts / 0005_snapshot.json.
-- Trigger bodies hold several statements, so breakpoints sit only between top-level statements.
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "tag_name_len_chk" CHECK(length("tag"."name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);
--> statement-breakpoint
CREATE TABLE `recipe_tag` (
	`recipe_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_tag_tag_id_idx` ON `recipe_tag` (`tag_id`);
--> statement-breakpoint
-- One FTS row per recipe. recipe_id is UNINDEXED (stored, not searchable). `notes` is reserved
-- and always '' until 04c adds triggers on the note table.
CREATE VIRTUAL TABLE `recipe_fts` USING fts5(
  recipe_id UNINDEXED,
  title,
  description,
  ingredients,
  tags,
  notes,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
--> statement-breakpoint
-- Backfill every existing recipe.
INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
SELECT r.id, r.title, coalesce(r.description, ''),
  coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
  coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
  ''
FROM recipe r;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_ai` AFTER INSERT ON `recipe`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = new.id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_au` AFTER UPDATE OF `title`, `description` ON `recipe`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = new.id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_ad` AFTER DELETE ON `recipe`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_ingredient_ai` AFTER INSERT ON `ingredient`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = new.recipe_id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = new.recipe_id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_ingredient_au` AFTER UPDATE OF `name`, `note` ON `ingredient`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = new.recipe_id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = new.recipe_id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_ingredient_ad` AFTER DELETE ON `ingredient`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = old.recipe_id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = old.recipe_id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_tag_ai` AFTER INSERT ON `recipe_tag`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = new.recipe_id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = new.recipe_id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_tag_ad` AFTER DELETE ON `recipe_tag`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = old.recipe_id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = old.recipe_id;
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_tag_au` AFTER UPDATE OF `name` ON `tag`
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id IN (SELECT recipe_id FROM recipe_tag WHERE tag_id = new.id);
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id IN (SELECT recipe_id FROM recipe_tag WHERE tag_id = new.id);
END;
--> statement-breakpoint
-- DB backstop for owner decision Q7 (at most 20 tags per recipe); the service validates first.
CREATE TRIGGER `recipe_tag_limit_bi` BEFORE INSERT ON `recipe_tag`
WHEN (SELECT count(*) FROM recipe_tag WHERE recipe_id = new.recipe_id) >= 20
BEGIN
  SELECT RAISE(ABORT, 'recipe_tag_limit');
END;
