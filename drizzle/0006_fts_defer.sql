-- Hand-written. Security checkpoint F1 (v0.4.0): the per-row ingredient / recipe_tag triggers of
-- 0005 rebuild the whole FTS row on every child row, which is quadratic in the number of
-- ingredients (4000 ingredients: ~12 s create, ~23 s update, blocking the single-threaded
-- server). Bulk writers now insert a marker row into recipe_fts_defer, write their children,
-- remove the marker and reindex once (src/lib/db/fts.ts). While the marker exists these
-- triggers do nothing; without a marker they behave exactly as in 0005.
CREATE TABLE `recipe_fts_defer` (
	`recipe_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
DROP TRIGGER `recipe_fts_ingredient_ai`;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_ingredient_ai` AFTER INSERT ON `ingredient`
WHEN NOT EXISTS (SELECT 1 FROM recipe_fts_defer WHERE recipe_id = new.recipe_id)
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
DROP TRIGGER `recipe_fts_ingredient_au`;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_ingredient_au` AFTER UPDATE OF `name`, `note` ON `ingredient`
WHEN NOT EXISTS (SELECT 1 FROM recipe_fts_defer WHERE recipe_id = new.recipe_id)
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
DROP TRIGGER `recipe_fts_ingredient_ad`;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_ingredient_ad` AFTER DELETE ON `ingredient`
WHEN NOT EXISTS (SELECT 1 FROM recipe_fts_defer WHERE recipe_id = old.recipe_id)
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
DROP TRIGGER `recipe_fts_recipe_tag_ai`;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_tag_ai` AFTER INSERT ON `recipe_tag`
WHEN NOT EXISTS (SELECT 1 FROM recipe_fts_defer WHERE recipe_id = new.recipe_id)
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
DROP TRIGGER `recipe_fts_recipe_tag_ad`;
--> statement-breakpoint
CREATE TRIGGER `recipe_fts_recipe_tag_ad` AFTER DELETE ON `recipe_tag`
WHEN NOT EXISTS (SELECT 1 FROM recipe_fts_defer WHERE recipe_id = old.recipe_id)
BEGIN
  DELETE FROM recipe_fts WHERE recipe_id = old.recipe_id;
  INSERT INTO recipe_fts (recipe_id, title, description, ingredients, tags, notes)
  SELECT r.id, r.title, coalesce(r.description, ''),
    coalesce((SELECT group_concat(trim(i.name || ' ' || coalesce(i.note, '')), ' ' ORDER BY i.id) FROM ingredient i WHERE i.recipe_id = r.id), ''),
    coalesce((SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    ''
  FROM recipe r WHERE r.id = old.recipe_id;
END;
