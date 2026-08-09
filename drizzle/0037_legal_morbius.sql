CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
