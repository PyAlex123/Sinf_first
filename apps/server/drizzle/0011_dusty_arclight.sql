CREATE TABLE `practice_checks` (
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`file_name` text,
	`file_sha` text,
	`report` text,
	`checked_at` text,
	`submitted_name` text,
	`submitted_sha` text,
	`submitted_report` text,
	`submitted_at` text,
	`marks` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`session_id`, `student_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `practice_checks_file_idx` ON `practice_checks` (`file_sha`);--> statement-breakpoint
CREATE INDEX `practice_checks_submitted_idx` ON `practice_checks` (`submitted_sha`);