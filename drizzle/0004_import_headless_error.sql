PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_import_job` (
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
	CONSTRAINT "import_job_status_chk" CHECK("__new_import_job"."status" IN ('queued', 'fetching', 'parsed', 'needs_review', 'failed', 'saved')),
	CONSTRAINT "import_job_method_chk" CHECK("__new_import_job"."method" IS NULL OR "__new_import_job"."method" IN ('static', 'headless', 'paste')),
	CONSTRAINT "import_job_error_code_chk" CHECK("__new_import_job"."error_code" IS NULL OR "__new_import_job"."error_code" IN ('blocked', 'no_recipe', 'timeout', 'invalid_url', 'private_address', 'too_large', 'fetch_failed', 'headless_unavailable'))
);
--> statement-breakpoint
INSERT INTO `__new_import_job`("id", "user_id", "url", "status", "method", "error_code", "raw_html_path", "draft_json", "recipe_id", "created_at", "updated_at") SELECT "id", "user_id", "url", "status", "method", "error_code", "raw_html_path", "draft_json", "recipe_id", "created_at", "updated_at" FROM `import_job`;--> statement-breakpoint
DROP TABLE `import_job`;--> statement-breakpoint
ALTER TABLE `__new_import_job` RENAME TO `import_job`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `import_job_user_created_idx` ON `import_job` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_job_recipe_id_idx` ON `import_job` (`recipe_id`);