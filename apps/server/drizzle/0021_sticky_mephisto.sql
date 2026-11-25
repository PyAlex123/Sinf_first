CREATE TABLE `pilot_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`school` text NOT NULL,
	`city` text NOT NULL,
	`name` text NOT NULL,
	`contact` text NOT NULL,
	`classes` integer,
	`comment` text DEFAULT '' NOT NULL,
	`locale` text DEFAULT 'ru' NOT NULL,
	`created_at` text NOT NULL,
	`handled_at` text
);
--> statement-breakpoint
CREATE INDEX `pilot_requests_created_idx` ON `pilot_requests` (`created_at`);