CREATE TABLE `rate_limits` (
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`resetAt` bigint NOT NULL,
	CONSTRAINT `rate_limits_key` PRIMARY KEY(`key`)
);
