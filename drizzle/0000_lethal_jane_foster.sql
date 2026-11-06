CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`viewer_id` integer,
	`username` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` text NOT NULL,
	`is_bot_response` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`viewer_id`) REFERENCES `viewers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_timestamp` ON `messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_viewer` ON `messages` (`viewer_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text,
	`message_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `viewers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`twitch_id` text NOT NULL,
	`username` text NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `viewers_twitch_id_unique` ON `viewers` (`twitch_id`);
