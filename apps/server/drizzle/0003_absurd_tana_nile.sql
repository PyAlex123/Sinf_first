CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`name` text NOT NULL,
	`room` text,
	`role` text NOT NULL,
	`pairing_code` text,
	`pairing_expires_at` text,
	`token_hash` text,
	`app_version` text,
	`platform` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `devices_school_idx` ON `devices` (`school_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_pairing_code_idx` ON `devices` (`pairing_code`);