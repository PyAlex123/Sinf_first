CREATE TABLE `journal_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `journal_columns_class_idx` ON `journal_columns` (`class_id`,`date`);--> statement-breakpoint
ALTER TABLE `grades` ADD `column_id` text;--> statement-breakpoint
ALTER TABLE `grades` ADD `absent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `grades` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `grades` ADD `synced_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `grades_column_student_idx` ON `grades` (`column_id`,`student_id`);