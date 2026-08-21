-- Self-healing FK constraints for the member graph. Each ADD CONSTRAINT below
-- can only fail if a child row already points at a parent that no longer exists
-- (an orphan). To keep the migration idempotent against any such legacy rows,
-- we first delete orphaned children, ordered roots -> leaves so that removing an
-- orphaned parent also clears its now-orphaned descendants. Orphan rows are
-- already unreachable, so deleting them loses no live data. In normal operation
-- parents are soft-deleted (deletedAt), so these DELETEs are no-ops.
DELETE FROM `members` WHERE `userId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `sessions` WHERE `podId` NOT IN (SELECT `id` FROM `pods`);--> statement-breakpoint
DELETE FROM `pod_members` WHERE `podId` NOT IN (SELECT `id` FROM `pods`);--> statement-breakpoint
DELETE FROM `pod_members` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `onboarding_milestones` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `membership_events` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `hive_score_history` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `member_change_requests` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `attendance` WHERE `sessionId` NOT IN (SELECT `id` FROM `sessions`);--> statement-breakpoint
DELETE FROM `attendance` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `event_regs` WHERE `eventId` NOT IN (SELECT `id` FROM `events`);--> statement-breakpoint
DELETE FROM `event_regs` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_regs` ADD CONSTRAINT `event_regs_eventId_events_id_fk` FOREIGN KEY (`eventId`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_regs` ADD CONSTRAINT `event_regs_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hive_score_history` ADD CONSTRAINT `hive_score_history_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_change_requests` ADD CONSTRAINT `member_change_requests_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `members` ADD CONSTRAINT `members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `membership_events` ADD CONSTRAINT `membership_events_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onboarding_milestones` ADD CONSTRAINT `onboarding_milestones_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pod_members` ADD CONSTRAINT `pod_members_podId_pods_id_fk` FOREIGN KEY (`podId`) REFERENCES `pods`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pod_members` ADD CONSTRAINT `pod_members_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_podId_pods_id_fk` FOREIGN KEY (`podId`) REFERENCES `pods`(`id`) ON DELETE cascade ON UPDATE no action;
