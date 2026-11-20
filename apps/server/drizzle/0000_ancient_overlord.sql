CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`student_id` text,
	`type` text NOT NULL,
	`at` text NOT NULL,
	`data` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_events_session_idx` ON `activity_events` (`session_id`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`joined_at` text,
	PRIMARY KEY(`session_id`, `student_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`name` text NOT NULL,
	`grade` integer NOT NULL,
	`academic_year` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classes_school_idx` ON `classes` (`school_id`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`session_id` text,
	`date` text NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`value` integer,
	`source` text NOT NULL,
	`comment` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `grades_class_date_idx` ON `grades` (`class_id`,`date`);--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`option_index` integer NOT NULL,
	`correct` integer NOT NULL,
	`time_ms` integer NOT NULL,
	`points` integer NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quiz_attempts_session_idx` ON `quiz_attempts` (`session_id`);--> statement-breakpoint
CREATE TABLE `schools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `screen_results` (
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`screen_index` integer NOT NULL,
	`stars` integer NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`first_at` text NOT NULL,
	`last_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `student_id`, `screen_index`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`join_code` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`demo_speed` integer DEFAULT 1 NOT NULL,
	`state_json` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_class_idx` ON `sessions` (`class_id`);--> statement-breakpoint
CREATE INDEX `sessions_join_code_idx` ON `sessions` (`join_code`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`code_kind` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_public` text NOT NULL,
	`is_virtual` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `students_class_idx` ON `students` (`class_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`full_name` text NOT NULL,
	`locale` text DEFAULT 'ru' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);