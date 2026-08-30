CREATE TABLE `newsletter_subscribers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255),
	`sourcePage` varchar(255),
	`status` enum('subscribed','unsubscribed') NOT NULL DEFAULT 'subscribed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`unsubscribedAt` timestamp,
	CONSTRAINT `newsletter_subscribers_id` PRIMARY KEY(`id`),
	CONSTRAINT `newsletter_subscribers_email_unique` UNIQUE(`email`)
);
