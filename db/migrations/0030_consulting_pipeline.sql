ALTER TABLE `invoices` MODIFY COLUMN `paymentRecordId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `invoices` ADD `leadId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `invoices` ADD `payerName` varchar(255);--> statement-breakpoint
ALTER TABLE `invoices` ADD `payerEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `leads` ADD `nextFollowUpAt` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_leadId_leads_id_fk` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_invoices_lead` ON `invoices` (`leadId`);