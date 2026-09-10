CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`claim` text NOT NULL,
	`polarity` text NOT NULL,
	`quote` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`date` text,
	`confidence` real NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_place_id_idx` ON `evidence` (`place_id`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`source` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_events_job_id_idx` ON `job_events` (`job_id`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`location_json` text NOT NULL,
	`request_text` text NOT NULL,
	`requirements_json` text NOT NULL,
	`intent_ids_json` text NOT NULL,
	`search_lang` text NOT NULL,
	`ui_locale` text NOT NULL,
	`timeout_sec` integer NOT NULL,
	`error_text` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_user_created_idx` ON `jobs` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `place_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`rating` real,
	`review_count` integer,
	`raw_json` text,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `place_sources_place_id_idx` ON `place_sources` (`place_id`);--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`category` text,
	`phone` text,
	`url` text,
	`lat` real,
	`lng` real,
	`canonical_key` text NOT NULL,
	`score` real,
	`conflicted` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `places_job_canonical_key_idx` ON `places` (`job_id`,`canonical_key`);--> statement-breakpoint
CREATE TABLE `replays` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`solari_session_id` text NOT NULL,
	`replay_url` text NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_secrets` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ciphertext` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`ui_locale` text DEFAULT 'en' NOT NULL,
	`default_search_lang` text,
	`default_timeout_sec` integer DEFAULT 480 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);