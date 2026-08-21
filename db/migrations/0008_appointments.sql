CREATE TABLE `appointments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`product` varchar(64) NOT NULL,
	`status` enum('requested','confirmed','cancelled') NOT NULL DEFAULT 'requested',
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(64),
	`notes` text,
	`scheduledAt` timestamp NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Dubai',
	`durationMin` int NOT NULL DEFAULT 30,
	`leadId` bigint unsigned,
	`confirmedAt` timestamp,
	`cancelledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ix_appointments_status` ON `appointments` (`status`);--> statement-breakpoint
CREATE INDEX `ix_appointments_scheduled` ON `appointments` (`scheduledAt`);--> statement-breakpoint
CREATE INDEX `ix_appointments_email` ON `appointments` (`email`);
