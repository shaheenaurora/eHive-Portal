ALTER TABLE `chapter_transfers` ADD `officerDecision` enum('pending','approved','rejected') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapter_transfers` ADD `officerNote` varchar(500);--> statement-breakpoint
ALTER TABLE `chapter_transfers` ADD `officerDecidedAt` timestamp;