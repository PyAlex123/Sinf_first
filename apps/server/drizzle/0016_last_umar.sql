CREATE TABLE `ktp_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`class_id` text NOT NULL,
	`title` text NOT NULL,
	`source_file` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ktp_plans_teacher_idx` ON `ktp_plans` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `ktp_plans_class_idx` ON `ktp_plans` (`class_id`);--> statement-breakpoint
CREATE TABLE `ktp_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`position` integer NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`topic` text NOT NULL,
	`hours` real,
	`week_or_date` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`original_topic` text,
	`original_week_or_date` text,
	`lesson_id` text,
	`is_done` integer DEFAULT false NOT NULL,
	`done_at` text,
	`deleted_at` text,
	FOREIGN KEY (`plan_id`) REFERENCES `ktp_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ktp_rows_plan_idx` ON `ktp_rows` (`plan_id`,`position`);