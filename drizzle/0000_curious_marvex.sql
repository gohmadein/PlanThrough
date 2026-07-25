CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`expected` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`project_name` text DEFAULT '' NOT NULL,
	`app_version` text NOT NULL,
	`page_url` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`viewport` text DEFAULT '' NOT NULL,
	`screenshot_key` text,
	`screenshot_name` text,
	`screenshot_type` text
);
--> statement-breakpoint
CREATE INDEX `feedback_created_at_idx` ON `feedback` (`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_category_idx` ON `feedback` (`category`);