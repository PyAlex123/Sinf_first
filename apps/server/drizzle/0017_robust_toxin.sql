CREATE TABLE `emaktab_marks` (
	`class_id` text NOT NULL,
	`column_id` text NOT NULL,
	`marked_by` text NOT NULL,
	`marked_at` text NOT NULL,
	PRIMARY KEY(`class_id`, `column_id`),
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
