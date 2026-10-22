CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`chatgpt_user_id` text NOT NULL,
	`username` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_chatgpt_user_id_unique` ON `users` (`chatgpt_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
