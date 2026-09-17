ALTER TABLE `jobs` ADD `search_lat` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `search_lng` real;--> statement-breakpoint
ALTER TABLE `places` DROP COLUMN `distance_km`;