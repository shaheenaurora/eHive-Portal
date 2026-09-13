CREATE TABLE `promo_codes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`kind` enum('percent','fixed') NOT NULL,
	`value` int NOT NULL,
	`tierScope` varchar(128),
	`maxUses` int,
	`usedCount` int NOT NULL DEFAULT 0,
	`startsAt` timestamp,
	`endsAt` timestamp,
	`active` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promo_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `promo_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`quote` text NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`authorRole` varchar(128),
	`authorChapter` varchar(128),
	`published` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `testimonials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `event_regs` ADD `paymentRecordId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `events` ADD `ticketPriceMinor` int;--> statement-breakpoint
ALTER TABLE `invoices` ADD `royaltyPeriod` varchar(7);--> statement-breakpoint
CREATE INDEX `ix_promo_codes_active` ON `promo_codes` (`active`,`endsAt`);--> statement-breakpoint
ALTER TABLE `event_regs` ADD CONSTRAINT `event_regs_paymentRecordId_payment_records_id_fk` FOREIGN KEY (`paymentRecordId`) REFERENCES `payment_records`(`id`) ON DELETE set null ON UPDATE no action;