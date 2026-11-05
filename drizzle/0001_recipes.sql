CREATE TABLE `ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`split_group_id` text,
	`portion_label` text,
	`name` text NOT NULL,
	`note` text,
	`raw_text` text NOT NULL,
	`metric_qty` real,
	`metric_unit` text,
	`us_qty` real,
	`us_unit` text,
	`display_primary` text DEFAULT 'metric' NOT NULL,
	`group_label` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ingredient_display_primary_chk" CHECK("ingredient"."display_primary" IN ('metric', 'us'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_section_position_uq` ON `ingredient` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `ingredient_recipe_id_idx` ON `ingredient` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`servings` real,
	`servings_label` text,
	`prep_minutes` integer,
	`cook_minutes` integer,
	`source_url` text,
	`source_name` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`share_token` text,
	`copied_from_id` text,
	`view_mode` text DEFAULT 'list' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`copied_from_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recipe_visibility_chk" CHECK("recipe"."visibility" IN ('private', 'users')),
	CONSTRAINT "recipe_view_mode_chk" CHECK("recipe"."view_mode" IN ('grid', 'list'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_share_token_unique` ON `recipe` (`share_token`);--> statement-breakpoint
CREATE INDEX `recipe_owner_id_idx` ON `recipe` (`owner_id`);--> statement-breakpoint
CREATE INDEX `recipe_copied_from_id_idx` ON `recipe` (`copied_from_id`);--> statement-breakpoint
CREATE INDEX `recipe_visibility_updated_at_idx` ON `recipe` (`visibility`,`updated_at`);--> statement-breakpoint
CREATE TABLE `section` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_recipe_position_uq` ON `section` (`recipe_id`,`position`);--> statement-breakpoint
CREATE TABLE `step` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`row_start` integer,
	`row_end` integer,
	`temp_c` integer,
	`temp_f` integer,
	`minutes_min` integer,
	`minutes_max` integer,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "step_kind_chk" CHECK("step"."kind" IN ('banner_top', 'column', 'banner_bottom')),
	CONSTRAINT "step_span_chk" CHECK(("step"."kind" IN ('banner_top', 'banner_bottom') AND "step"."row_start" IS NULL AND "step"."row_end" IS NULL) OR ("step"."kind" = 'column' AND (("step"."row_start" IS NULL AND "step"."row_end" IS NULL) OR ("step"."row_start" IS NOT NULL AND "step"."row_end" IS NOT NULL AND "step"."row_start" >= 0 AND "step"."row_start" <= "step"."row_end"))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_section_position_uq` ON `step` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `step_recipe_id_idx` ON `step` (`recipe_id`);