-- Governance & event write-integrity (gap G2) + motion quorum (G5). Enforce
-- "one per person" and capacity at the database, and add the "failed"
-- (quorum-not-met) motion status. Each unique constraint is preceded by a DELETE
-- that de-duplicates any rows an earlier race may have created, so the migration
-- is self-healing and can't fail on pre-existing duplicates.
--
-- ballot_roll and motion_votes convert an existing composite index to UNIQUE in a
-- single ALTER (DROP INDEX + ADD UNIQUE INDEX together): that index backs a
-- foreign key, so a standalone DROP fails with ER_DROP_INDEX_FK. Combining both
-- operations means the FK always has a backing index and MySQL accepts it.
ALTER TABLE `motions` MODIFY COLUMN `status` enum('open','passed','rejected','failed') NOT NULL DEFAULT 'open';--> statement-breakpoint
DELETE `b` FROM `ballot_roll` `b` JOIN `ballot_roll` `keep` ON `keep`.`electionId` = `b`.`electionId` AND `keep`.`memberId` = `b`.`memberId` AND `keep`.`id` < `b`.`id`;--> statement-breakpoint
ALTER TABLE `ballot_roll` DROP INDEX `ix_ballotroll_election_member`, ADD UNIQUE INDEX `ix_ballotroll_election_member` (`electionId`,`memberId`);--> statement-breakpoint
DELETE `r` FROM `event_regs` `r` JOIN `event_regs` `keep` ON `keep`.`eventId` = `r`.`eventId` AND `keep`.`memberId` = `r`.`memberId` AND `keep`.`id` > `r`.`id`;--> statement-breakpoint
ALTER TABLE `event_regs` ADD CONSTRAINT `ux_eventregs_event_member` UNIQUE(`eventId`,`memberId`);--> statement-breakpoint
DELETE `v` FROM `motion_votes` `v` JOIN `motion_votes` `keep` ON `keep`.`motionId` = `v`.`motionId` AND `keep`.`memberId` = `v`.`memberId` AND `keep`.`id` < `v`.`id`;--> statement-breakpoint
ALTER TABLE `motion_votes` DROP INDEX `ix_motionvotes_motion_member`, ADD UNIQUE INDEX `ix_motionvotes_motion_member` (`motionId`,`memberId`);
