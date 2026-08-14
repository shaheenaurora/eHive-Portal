CREATE TABLE `award_records` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cycleId` bigint unsigned,
	`awardKey` varchar(64) NOT NULL,
	`label` varchar(160) NOT NULL,
	`level` enum('network','chapter','zone','region','country') NOT NULL DEFAULT 'network',
	`memberId` bigint unsigned,
	`chapterId` bigint unsigned,
	`source` enum('auto','panel','vote') NOT NULL,
	`score` int,
	`points` int NOT NULL DEFAULT 0,
	`conferredByUserId` bigint unsigned,
	`conferredAt` timestamp NOT NULL DEFAULT (now()),
	`note` varchar(500),
	CONSTRAINT `award_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ix_awardrecords_member` ON `award_records` (`memberId`);--> statement-breakpoint
CREATE INDEX `ix_awardrecords_award` ON `award_records` (`awardKey`,`conferredAt`);