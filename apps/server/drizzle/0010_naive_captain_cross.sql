CREATE TABLE `student_files` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text,
	`updated_at` text NOT NULL,
	`origin` text NOT NULL,
	`deleted_at` text,
	`cloud_sha` text,
	`dirty` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_files_name_idx` ON `student_files` (`student_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `student_files_sha_idx` ON `student_files` (`sha256`);--> statement-breakpoint
ALTER TABLE `classes` ADD `home_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `classes_home_code_idx` ON `classes` (`home_code`);