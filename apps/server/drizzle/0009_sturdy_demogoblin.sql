ALTER TABLE `screenshots` ADD `synced_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `grades_session_student_idx` ON `grades` (`session_id`,`student_id`);