CREATE TABLE `scorecard_results` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255),
	`phone` varchar(64),
	`company` varchar(255),
	`location` varchar(255),
	`industry` varchar(128),
	`total` int NOT NULL,
	`domains` json,
	`recommendationProduct` varchar(128),
	`recommendationWhy` text,
	`nurtureStage` enum('new','emailed','follow_up_1','follow_up_2','replied','booked','disqualified') NOT NULL DEFAULT 'new',
	`emailedAt` timestamp,
	`leadId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scorecard_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ix_scorecard_email` ON `scorecard_results` (`email`);--> statement-breakpoint
CREATE INDEX `ix_scorecard_stage` ON `scorecard_results` (`nurtureStage`);
