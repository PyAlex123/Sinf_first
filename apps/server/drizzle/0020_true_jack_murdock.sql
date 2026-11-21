CREATE TABLE `licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`classes_limit` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `licenses_school_idx` ON `licenses` (`school_id`);