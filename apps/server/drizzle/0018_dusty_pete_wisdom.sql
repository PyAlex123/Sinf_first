CREATE TABLE `school_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`used` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_invites_token_idx` ON `school_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `school_invites_school_idx` ON `school_invites` (`school_id`);