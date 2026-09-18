CREATE TABLE `extraction_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`findings_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `extraction_cache_expires_idx` ON `extraction_cache` (`expires_at`);