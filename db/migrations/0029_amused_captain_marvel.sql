-- Governance & event write-integrity (gap G2) + motion quorum (G5). Enforce
-- "one per person" and capacity at the database, and add the "failed"
-- (quorum-not-met) motion status. Each unique constraint is preceded by a DELETE
-- that de-duplicates any rows an earlier race may have created, so the migration
-- is self-healing and can't fail on pre-existing duplicates.
DROP INDEX `ix_ballotroll_election_member` ON `ballot_roll`;--> statement-breakpoint
DROP INDEX `ix_motionvotes_motion_member` ON `motion_votes`;--> statement-breakpoint
ALTER TABLE `motions` MODIFY COLUMN `status` enum('open','passed','rejected','failed') NOT NULL DEFAULT 'open';--> statement-breakpoint
DELETE `b` FROM `ballot_roll` `b` JOIN `ballot_roll` `keep` ON `keep`.`electionId` = `b`.`electionId` AND `keep`.`memberId` = `b`.`memberId` AND `keep`.`id` < `b`.`id`;--> statement-breakpoint
ALTER TABLE `ballot_roll` ADD CONSTRAINT `ix_ballotroll_election_member` UNIQUE(`electionId`,`memberId`);--> statement-breakpoint
DELETE `r` FROM `event_regs` `r` JOIN `event_regs` `keep` ON `keep`.`eventId` = `r`.`eventId` AND `keep`.`memberId` = `r`.`memberId` AND `keep`.`id` > `r`.`id`;--> statement-breakpoint
ALTER TABLE `event_regs` ADD CONSTRAINT `ux_eventregs_event_member` UNIQUE(`eventId`,`memberId`);--> statement-breakpoint
DELETE `v` FROM `motion_votes` `v` JOIN `motion_votes` `keep` ON `keep`.`motionId` = `v`.`motionId` AND `keep`.`memberId` = `v`.`memberId` AND `keep`.`id` < `v`.`id`;--> statement-breakpoint
ALTER TABLE `motion_votes` ADD CONSTRAINT `ix_motionvotes_motion_member` UNIQUE(`motionId`,`memberId`);
