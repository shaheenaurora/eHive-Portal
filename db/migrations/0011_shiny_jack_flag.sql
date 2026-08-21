CREATE TABLE `credit_notes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`paymentRecordId` bigint unsigned NOT NULL,
	`invoiceId` bigint unsigned,
	`memberId` bigint unsigned,
	`userId` bigint unsigned NOT NULL,
	`creditNoteNumber` varchar(32) NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'aed',
	`reason` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_notes_creditNoteNumber_unique` UNIQUE(`creditNoteNumber`)
);
--> statement-breakpoint
CREATE TABLE `invoice_counters` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`date` varchar(8) NOT NULL,
	`sequence` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_counters_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_counters_prefix_date_unique` UNIQUE(`prefix`,`date`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`paymentRecordId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned,
	`userId` bigint unsigned NOT NULL,
	`invoiceNumber` varchar(32) NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'aed',
	`status` enum('open','paid','void') NOT NULL DEFAULT 'open',
	`billedAt` timestamp NOT NULL,
	`dueAt` timestamp,
	`lineItems` json NOT NULL,
	`pdfUrl` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
--> statement-breakpoint
ALTER TABLE `scorecard_results` DROP FOREIGN KEY `scorecard_results_leadId_fk`;
--> statement-breakpoint
ALTER TABLE `appointments` DROP FOREIGN KEY `appointments_leadId_fk`;
--> statement-breakpoint
ALTER TABLE `appointments` MODIFY COLUMN `status` enum('requested','confirmed','cancelled','no_show') NOT NULL DEFAULT 'requested';--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `credit_notes_paymentRecordId_payment_records_id_fk` FOREIGN KEY (`paymentRecordId`) REFERENCES `payment_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `credit_notes_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_paymentRecordId_payment_records_id_fk` FOREIGN KEY (`paymentRecordId`) REFERENCES `payment_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_credit_notes_payment_record` ON `credit_notes` (`paymentRecordId`);--> statement-breakpoint
CREATE INDEX `ix_credit_notes_invoice` ON `credit_notes` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `ix_credit_notes_user` ON `credit_notes` (`userId`);--> statement-breakpoint
CREATE INDEX `ix_credit_notes_member` ON `credit_notes` (`memberId`);--> statement-breakpoint
CREATE INDEX `ix_invoices_payment_record` ON `invoices` (`paymentRecordId`);--> statement-breakpoint
CREATE INDEX `ix_invoices_user` ON `invoices` (`userId`);--> statement-breakpoint
CREATE INDEX `ix_invoices_member` ON `invoices` (`memberId`);--> statement-breakpoint
CREATE INDEX `ix_invoices_status` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `ix_invoices_billed_at` ON `invoices` (`billedAt`);--> statement-breakpoint
ALTER TABLE `scorecard_results` ADD CONSTRAINT `scorecard_results_leadId_leads_id_fk` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_leadId_leads_id_fk` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE set null ON UPDATE no action;