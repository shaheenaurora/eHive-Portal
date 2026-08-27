CREATE TABLE `analytics_events` (
	`id` serial AUTO_INCREMENT PRIMARY KEY,
	`event` varchar(64) NOT NULL,
	`visitor_id` varchar(64),
	`userId` bigint unsigned,
	`properties` text,
	`url` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE INDEX `ix_analytics_event_created` ON `analytics_events` (`event`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `ix_analytics_visitor` ON `analytics_events` (`visitor_id`);
--> statement-breakpoint
CREATE INDEX `ix_analytics_user` ON `analytics_events` (`userId`);
