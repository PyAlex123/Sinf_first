CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `synced_at` text;