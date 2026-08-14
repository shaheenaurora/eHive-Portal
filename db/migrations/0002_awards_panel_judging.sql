CREATE TABLE `award_judges` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cycleId` bigint unsigned NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`assignedByUserId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `award_judges_id` PRIMARY KEY(`id`),
	CONSTRAINT `award_judges_cycle_user_unique` UNIQUE(`cycleId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `award_scores` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cycleId` bigint unsigned NOT NULL,
	`nominationId` bigint unsigned NOT NULL,
	`judgeUserId` bigint unsigned NOT NULL,
	`scores` text NOT NULL,
	`total` int NOT NULL,
	`note` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `award_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `award_scores_nomination_judge_unique` UNIQUE(`nominationId`,`judgeUserId`)
);
--> statement-breakpoint
ALTER TABLE `award_cycles` ADD `rubric` text;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD `ratifiedByUserId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD `ratifiedAt` timestamp;--> statement-breakpoint
CREATE INDEX `ix_awardscores_cycle` ON `award_scores` (`cycleId`);