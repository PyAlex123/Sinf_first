CREATE TABLE `library_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_reports_item_idx` ON `library_reports` (`kind`,`item_id`);--> statement-breakpoint
ALTER TABLE `authored_lessons` ADD `hidden_at` text;--> statement-breakpoint
ALTER TABLE `programs` ADD `hidden_at` text;