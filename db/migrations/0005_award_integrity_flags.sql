CREATE TABLE `award_integrity_flags` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cycleId` bigint unsigned NOT NULL,
	`nominationId` bigint unsigned,
	`memberId` bigint unsigned,
	`kind` enum('conflict','reciprocity','vote_velocity','conduct','manual') NOT NULL,
	`severity` enum('info','warn','block') NOT NULL DEFAULT 'warn',
	`detail` varchar(500) NOT NULL,
	`status` enum('open','cleared','upheld') NOT NULL DEFAULT 'open',
	`raisedByUserId` bigint unsigned,
	`resolvedByUserId` bigint unsigned,
	`resolutionNote` varchar(500),
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `award_integrity_flags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ix_integrityflags_cycle` ON `award_integrity_flags` (`cycleId`);--> statement-breakpoint
CREATE INDEX `ix_integrityflags_nomination` ON `award_integrity_flags` (`nominationId`);--> statement-breakpoint
CREATE INDEX `ix_integrityflags_dedupe` ON `award_integrity_flags` (`cycleId`,`kind`,`nominationId`,`status`);