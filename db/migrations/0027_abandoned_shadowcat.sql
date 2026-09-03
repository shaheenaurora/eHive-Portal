ALTER TABLE `payment_records` ADD `idempotencyKey` varchar(64);
--> statement-breakpoint
ALTER TABLE `payment_records` ADD CONSTRAINT `payment_records_idempotency_key_unique` UNIQUE(`idempotencyKey`);
