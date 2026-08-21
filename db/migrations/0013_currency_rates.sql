CREATE TABLE `currency_rates` (
	`code` varchar(8) NOT NULL,
	`rateScaled` bigint unsigned NOT NULL,
	`updatedByUserId` bigint unsigned,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `currency_rates_code` PRIMARY KEY(`code`)
);
