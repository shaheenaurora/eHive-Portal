CREATE TABLE `assessment_reports` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tool` varchar(32) NOT NULL,
	`token` varchar(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`contact` json,
	`answers` json,
	`dims` json,
	`total` int NOT NULL,
	`band` varchar(32),
	`paid` enum('free','requested','paid') NOT NULL DEFAULT 'free',
	`stripeSessionId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assessment_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `assessment_reports_token_unique` UNIQUE(`token`),
	CONSTRAINT `ux_assessment_reports_tool_email` UNIQUE(`tool`,`email`)
);
--> statement-breakpoint
CREATE INDEX `ix_assessment_reports_email` ON `assessment_reports` (`email`);