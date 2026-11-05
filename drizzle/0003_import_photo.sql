CREATE TABLE `import_job` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`method` text,
	`error_code` text,
	`raw_html_path` text,
	`draft_json` text,
	`recipe_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_job_status_chk" CHECK("import_job"."status" IN ('queued', 'fetching', 'parsed', 'needs_review', 'failed', 'saved')),
	CONSTRAINT "import_job_method_chk" CHECK("import_job"."method" IS NULL OR "import_job"."method" IN ('static', 'headless', 'paste')),
	CONSTRAINT "import_job_error_code_chk" CHECK("import_job"."error_code" IS NULL OR "import_job"."error_code" IN ('blocked', 'no_recipe', 'timeout', 'invalid_url', 'private_address', 'too_large', 'fetch_failed'))
);
--> statement-breakpoint
CREATE INDEX `import_job_user_created_idx` ON `import_job` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_job_recipe_id_idx` ON `import_job` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `photo` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`file_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "photo_is_cover_chk" CHECK("photo"."is_cover" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `photo_recipe_id_idx` ON `photo` (`recipe_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_one_cover_uq` ON `photo` (`recipe_id`) WHERE "photo"."is_cover" = 1;--> statement-breakpoint
CREATE INDEX `recipe_source_url_idx` ON `recipe` (`source_url`);