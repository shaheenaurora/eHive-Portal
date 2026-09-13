CREATE TABLE `benefit_redemptions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`kind` enum('offer','advisory','event','activation','other') NOT NULL DEFAULT 'other',
	`label` varchar(255) NOT NULL,
	`valueSavedAed` int NOT NULL DEFAULT 0,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdByUserId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `benefit_redemptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `benefit_redemptions` ADD CONSTRAINT `benefit_redemptions_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_benefit_member` ON `benefit_redemptions` (`memberId`);