CREATE TABLE `authored_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`grade` integer NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`doc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `authored_lessons_owner_idx` ON `authored_lessons` (`owner_id`);