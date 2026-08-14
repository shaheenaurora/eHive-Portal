CREATE TABLE `award_votes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cycleId` bigint unsigned NOT NULL,
	`nominationId` bigint unsigned NOT NULL,
	`voterMemberId` bigint unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `award_votes_id` PRIMARY KEY(`id`),
	CONSTRAINT `award_votes_cycle_voter_unique` UNIQUE(`cycleId`,`voterMemberId`)
);
--> statement-breakpoint
CREATE INDEX `ix_awardvotes_nomination` ON `award_votes` (`nominationId`);