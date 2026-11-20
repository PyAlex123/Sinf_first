CREATE TABLE `seats` (
	`class_id` text NOT NULL,
	`pc` text NOT NULL,
	`student_id` text NOT NULL,
	`last_used_at` text NOT NULL,
	PRIMARY KEY(`class_id`, `pc`),
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `seats_student_idx` ON `seats` (`student_id`);