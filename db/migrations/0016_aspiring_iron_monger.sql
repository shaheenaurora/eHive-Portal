-- Orphan cleanup for new FK constraints. Each statement below removes rows
-- (or nulls a self-reference) whose referenced parent no longer exists, ordered
-- roots -> leaves so deleting an orphaned parent first causes its descendants
-- to be removed by the later child-table cleanups.
UPDATE `org_units` o LEFT JOIN `org_units` p ON o.`parentId` = p.`id` SET o.`parentId` = NULL WHERE o.`parentId` IS NOT NULL AND p.`id` IS NULL;--> statement-breakpoint
DELETE FROM `chapters` WHERE `zoneId` NOT IN (SELECT `id` FROM `org_units`);--> statement-breakpoint
DELETE FROM `council_meetings` WHERE `unitId` NOT IN (SELECT `id` FROM `org_units`);--> statement-breakpoint
DELETE FROM `meetings` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `motions` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `cadences` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `prospects` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `prospects` WHERE `ownerUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `elections` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `candidates` WHERE `electionId` NOT IN (SELECT `id` FROM `elections`);--> statement-breakpoint
DELETE FROM `candidates` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `ballots` WHERE `electionId` NOT IN (SELECT `id` FROM `elections`);--> statement-breakpoint
DELETE FROM `ballots` WHERE `candidateId` NOT IN (SELECT `id` FROM `candidates`);--> statement-breakpoint
DELETE FROM `ballot_roll` WHERE `electionId` NOT IN (SELECT `id` FROM `elections`);--> statement-breakpoint
DELETE FROM `ballot_roll` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `motion_votes` WHERE `motionId` NOT IN (SELECT `id` FROM `motions`);--> statement-breakpoint
DELETE FROM `motion_votes` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `meeting_attendance` WHERE `meetingId` NOT IN (SELECT `id` FROM `meetings`);--> statement-breakpoint
DELETE FROM `meeting_attendance` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `cadence_log` WHERE `cadenceId` NOT IN (SELECT `id` FROM `cadences`);--> statement-breakpoint
DELETE FROM `cadence_log` WHERE `actorMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `chapter_roles` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `chapter_roles` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `chapter_roles` WHERE `electionId` NOT IN (SELECT `id` FROM `elections`);--> statement-breakpoint
DELETE FROM `chapter_posts` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `chapter_posts` WHERE `authorMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `chapter_transfers` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `chapter_transfers` WHERE `fromChapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `chapter_transfers` WHERE `toChapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `chapter_budgets` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `chapter_budgets` WHERE `approvedByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `health_snapshots` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `award_nominations` WHERE `cycleId` NOT IN (SELECT `id` FROM `award_cycles`);--> statement-breakpoint
DELETE FROM `award_nominations` WHERE `nomineeMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `award_nominations` WHERE `nomineeChapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `award_nominations` WHERE `nominatedByMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `award_nominations` WHERE `ratifiedByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `award_judges` WHERE `cycleId` NOT IN (SELECT `id` FROM `award_cycles`);--> statement-breakpoint
DELETE FROM `award_judges` WHERE `userId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `award_judges` WHERE `assignedByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `award_votes` WHERE `cycleId` NOT IN (SELECT `id` FROM `award_cycles`);--> statement-breakpoint
DELETE FROM `award_votes` WHERE `nominationId` NOT IN (SELECT `id` FROM `award_nominations`);--> statement-breakpoint
DELETE FROM `award_votes` WHERE `voterMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `award_scores` WHERE `cycleId` NOT IN (SELECT `id` FROM `award_cycles`);--> statement-breakpoint
DELETE FROM `award_scores` WHERE `nominationId` NOT IN (SELECT `id` FROM `award_nominations`);--> statement-breakpoint
DELETE FROM `award_scores` WHERE `judgeUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `award_records` WHERE `cycleId` NOT IN (SELECT `id` FROM `award_cycles`);--> statement-breakpoint
DELETE FROM `award_records` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `award_records` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `award_records` WHERE `conferredByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `award_integrity_flags` WHERE `cycleId` NOT IN (SELECT `id` FROM `award_cycles`);--> statement-breakpoint
DELETE FROM `award_integrity_flags` WHERE `nominationId` NOT IN (SELECT `id` FROM `award_nominations`);--> statement-breakpoint
DELETE FROM `award_integrity_flags` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `award_integrity_flags` WHERE `raisedByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `award_integrity_flags` WHERE `resolvedByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `council_decisions` WHERE `unitId` NOT IN (SELECT `id` FROM `org_units`);--> statement-breakpoint
DELETE FROM `council_decisions` WHERE `meetingId` NOT IN (SELECT `id` FROM `council_meetings`);--> statement-breakpoint
DELETE FROM `unit_roles` WHERE `unitId` NOT IN (SELECT `id` FROM `org_units`);--> statement-breakpoint
DELETE FROM `unit_roles` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `follow_ups` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `follow_ups` WHERE `prospectId` NOT IN (SELECT `id` FROM `prospects`);--> statement-breakpoint
DELETE FROM `follow_ups` WHERE `ownerUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `conduct_cases` WHERE `reporterMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `conduct_cases` WHERE `subjectMemberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `conduct_cases` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `conduct_cases` WHERE `handledByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `conduct_cases` WHERE `appealReviewerUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `member_save_cases` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `member_save_cases` WHERE `chapterId` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
DELETE FROM `member_save_cases` WHERE `ownerUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `data_requests` WHERE `memberId` NOT IN (SELECT `id` FROM `members`);--> statement-breakpoint
DELETE FROM `currency_rates` WHERE `updatedByUserId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint

ALTER TABLE `award_integrity_flags` ADD CONSTRAINT `award_integrity_flags_cycleId_award_cycles_id_fk` FOREIGN KEY (`cycleId`) REFERENCES `award_cycles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_integrity_flags` ADD CONSTRAINT `award_integrity_flags_nominationId_award_nominations_id_fk` FOREIGN KEY (`nominationId`) REFERENCES `award_nominations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_integrity_flags` ADD CONSTRAINT `award_integrity_flags_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_integrity_flags` ADD CONSTRAINT `award_integrity_flags_raisedByUserId_users_id_fk` FOREIGN KEY (`raisedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_integrity_flags` ADD CONSTRAINT `award_integrity_flags_resolvedByUserId_users_id_fk` FOREIGN KEY (`resolvedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_judges` ADD CONSTRAINT `award_judges_cycleId_award_cycles_id_fk` FOREIGN KEY (`cycleId`) REFERENCES `award_cycles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_judges` ADD CONSTRAINT `award_judges_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_judges` ADD CONSTRAINT `award_judges_assignedByUserId_users_id_fk` FOREIGN KEY (`assignedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD CONSTRAINT `award_nominations_cycleId_award_cycles_id_fk` FOREIGN KEY (`cycleId`) REFERENCES `award_cycles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD CONSTRAINT `award_nominations_nomineeMemberId_members_id_fk` FOREIGN KEY (`nomineeMemberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD CONSTRAINT `award_nominations_nomineeChapterId_chapters_id_fk` FOREIGN KEY (`nomineeChapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD CONSTRAINT `award_nominations_nominatedByMemberId_members_id_fk` FOREIGN KEY (`nominatedByMemberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_nominations` ADD CONSTRAINT `award_nominations_ratifiedByUserId_users_id_fk` FOREIGN KEY (`ratifiedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_records` ADD CONSTRAINT `award_records_cycleId_award_cycles_id_fk` FOREIGN KEY (`cycleId`) REFERENCES `award_cycles`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_records` ADD CONSTRAINT `award_records_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_records` ADD CONSTRAINT `award_records_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_records` ADD CONSTRAINT `award_records_conferredByUserId_users_id_fk` FOREIGN KEY (`conferredByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_scores` ADD CONSTRAINT `award_scores_cycleId_award_cycles_id_fk` FOREIGN KEY (`cycleId`) REFERENCES `award_cycles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_scores` ADD CONSTRAINT `award_scores_nominationId_award_nominations_id_fk` FOREIGN KEY (`nominationId`) REFERENCES `award_nominations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_scores` ADD CONSTRAINT `award_scores_judgeUserId_users_id_fk` FOREIGN KEY (`judgeUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_votes` ADD CONSTRAINT `award_votes_cycleId_award_cycles_id_fk` FOREIGN KEY (`cycleId`) REFERENCES `award_cycles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_votes` ADD CONSTRAINT `award_votes_nominationId_award_nominations_id_fk` FOREIGN KEY (`nominationId`) REFERENCES `award_nominations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `award_votes` ADD CONSTRAINT `award_votes_voterMemberId_members_id_fk` FOREIGN KEY (`voterMemberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ballot_roll` ADD CONSTRAINT `ballot_roll_electionId_elections_id_fk` FOREIGN KEY (`electionId`) REFERENCES `elections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ballot_roll` ADD CONSTRAINT `ballot_roll_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ballots` ADD CONSTRAINT `ballots_electionId_elections_id_fk` FOREIGN KEY (`electionId`) REFERENCES `elections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ballots` ADD CONSTRAINT `ballots_candidateId_candidates_id_fk` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cadence_log` ADD CONSTRAINT `cadence_log_cadenceId_cadences_id_fk` FOREIGN KEY (`cadenceId`) REFERENCES `cadences`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cadence_log` ADD CONSTRAINT `cadence_log_actorMemberId_members_id_fk` FOREIGN KEY (`actorMemberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cadences` ADD CONSTRAINT `cadences_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_electionId_elections_id_fk` FOREIGN KEY (`electionId`) REFERENCES `elections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_budgets` ADD CONSTRAINT `chapter_budgets_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_budgets` ADD CONSTRAINT `chapter_budgets_approvedByUserId_users_id_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_posts` ADD CONSTRAINT `chapter_posts_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_posts` ADD CONSTRAINT `chapter_posts_authorMemberId_members_id_fk` FOREIGN KEY (`authorMemberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_roles` ADD CONSTRAINT `chapter_roles_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_roles` ADD CONSTRAINT `chapter_roles_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_roles` ADD CONSTRAINT `chapter_roles_electionId_elections_id_fk` FOREIGN KEY (`electionId`) REFERENCES `elections`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_transfers` ADD CONSTRAINT `chapter_transfers_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_transfers` ADD CONSTRAINT `chapter_transfers_fromChapterId_chapters_id_fk` FOREIGN KEY (`fromChapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapter_transfers` ADD CONSTRAINT `chapter_transfers_toChapterId_chapters_id_fk` FOREIGN KEY (`toChapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chapters` ADD CONSTRAINT `chapters_zoneId_org_units_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `org_units`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conduct_cases` ADD CONSTRAINT `conduct_cases_reporterMemberId_members_id_fk` FOREIGN KEY (`reporterMemberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conduct_cases` ADD CONSTRAINT `conduct_cases_subjectMemberId_members_id_fk` FOREIGN KEY (`subjectMemberId`) REFERENCES `members`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conduct_cases` ADD CONSTRAINT `conduct_cases_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conduct_cases` ADD CONSTRAINT `conduct_cases_handledByUserId_users_id_fk` FOREIGN KEY (`handledByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conduct_cases` ADD CONSTRAINT `conduct_cases_appealReviewerUserId_users_id_fk` FOREIGN KEY (`appealReviewerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `council_decisions` ADD CONSTRAINT `council_decisions_unitId_org_units_id_fk` FOREIGN KEY (`unitId`) REFERENCES `org_units`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `council_decisions` ADD CONSTRAINT `council_decisions_meetingId_council_meetings_id_fk` FOREIGN KEY (`meetingId`) REFERENCES `council_meetings`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `council_meetings` ADD CONSTRAINT `council_meetings_unitId_org_units_id_fk` FOREIGN KEY (`unitId`) REFERENCES `org_units`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `currency_rates` ADD CONSTRAINT `currency_rates_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_requests` ADD CONSTRAINT `data_requests_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `elections` ADD CONSTRAINT `elections_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_prospectId_prospects_id_fk` FOREIGN KEY (`prospectId`) REFERENCES `prospects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `health_snapshots` ADD CONSTRAINT `health_snapshots_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meeting_attendance` ADD CONSTRAINT `meeting_attendance_meetingId_meetings_id_fk` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meeting_attendance` ADD CONSTRAINT `meeting_attendance_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meetings` ADD CONSTRAINT `meetings_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_save_cases` ADD CONSTRAINT `member_save_cases_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_save_cases` ADD CONSTRAINT `member_save_cases_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_save_cases` ADD CONSTRAINT `member_save_cases_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `motion_votes` ADD CONSTRAINT `motion_votes_motionId_motions_id_fk` FOREIGN KEY (`motionId`) REFERENCES `motions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `motion_votes` ADD CONSTRAINT `motion_votes_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `motions` ADD CONSTRAINT `motions_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `org_units` ADD CONSTRAINT `org_units_parentId_org_units_id_fk` FOREIGN KEY (`parentId`) REFERENCES `org_units`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_chapterId_chapters_id_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `unit_roles` ADD CONSTRAINT `unit_roles_unitId_org_units_id_fk` FOREIGN KEY (`unitId`) REFERENCES `org_units`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `unit_roles` ADD CONSTRAINT `unit_roles_memberId_members_id_fk` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;