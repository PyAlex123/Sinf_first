CREATE TABLE `practice_results` (
	`session_id` text NOT NULL,
	`student_id` text NOT NULL,
	`stars` integer NOT NULL,
	`steps_done` integer DEFAULT 0 NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`session_id`, `student_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
