CREATE TABLE `notification_deliveries` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`notificationId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`channel` enum('email','push') NOT NULL,
	`status` enum('pending','sent','failed','bounced') NOT NULL DEFAULT 'pending',
	`providerRef` varchar(255),
	`error` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_notificationId_notifications_id_fk` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_notification_deliveries_notification` ON `notification_deliveries` (`notificationId`);--> statement-breakpoint
CREATE INDEX `ix_notification_deliveries_member_status` ON `notification_deliveries` (`memberId`,`status`);
