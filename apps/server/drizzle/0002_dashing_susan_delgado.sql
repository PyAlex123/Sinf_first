CREATE TABLE `school_join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_join_requests_pair_idx` ON `school_join_requests` (`school_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `school_join_requests_school_idx` ON `school_join_requests` (`school_id`);--> statement-breakpoint
ALTER TABLE `schools` ADD `city` text;--> statement-breakpoint
ALTER TABLE `schools` ADD `settings` text DEFAULT '{}' NOT NULL;