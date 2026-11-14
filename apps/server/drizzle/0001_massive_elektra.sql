CREATE TABLE `class_teachers` (
	`class_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`class_id`, `user_id`),
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `class_teachers_user_idx` ON `class_teachers` (`user_id`);--> statement-breakpoint
CREATE TABLE `school_members` (
	`school_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`school_id`, `user_id`),
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `school_members_user_idx` ON `school_members` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`grade` integer NOT NULL,
	`academic_year` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_classes`("id", "school_id", "owner_id", "name", "grade", "academic_year", "settings", "created_at") SELECT "id", "school_id", (SELECT "id" FROM `users` ORDER BY "created_at", "id" LIMIT 1), "name", "grade", "academic_year", "settings", "created_at" FROM `classes`;--> statement-breakpoint
DROP TABLE `classes`;--> statement-breakpoint
ALTER TABLE `__new_classes` RENAME TO `classes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `classes_school_idx` ON `classes` (`school_id`);--> statement-breakpoint
CREATE INDEX `classes_owner_idx` ON `classes` (`owner_id`);