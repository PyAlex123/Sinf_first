CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`grade` integer NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`items` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `programs_owner_idx` ON `programs` (`owner_id`);--> statement-breakpoint
ALTER TABLE `classes` ADD `program_id` text;