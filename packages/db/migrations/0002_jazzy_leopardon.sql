PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_replays` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`solari_session_id` text NOT NULL,
	`replay_url` text,
	`expires_at` integer,
	`adapter_id` text,
	`finding_count` integer,
	`status` text,
	`stored_path` text,
	`size_bytes` integer,
	`content_type` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_replays`("id", "job_id", "solari_session_id", "replay_url", "expires_at", "adapter_id", "finding_count", "status", "stored_path", "size_bytes", "content_type") SELECT "id", "job_id", "solari_session_id", "replay_url", "expires_at", "adapter_id", "finding_count", "status", "stored_path", "size_bytes", "content_type" FROM `replays`;--> statement-breakpoint
DROP TABLE `replays`;--> statement-breakpoint
ALTER TABLE `__new_replays` RENAME TO `replays`;--> statement-breakpoint
PRAGMA foreign_keys=ON;