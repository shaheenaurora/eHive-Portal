CREATE TABLE `action_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`podId` bigint unsigned NOT NULL,
	`sessionId` bigint unsigned,
	`memberId` bigint unsigned NOT NULL,
	`text` varchar(512) NOT NULL,
	`dueAt` timestamp,
	`status` enum('open','done') NOT NULL DEFAULT 'open',
	`doneAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `action_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`actorUserId` bigint unsigned NOT NULL,
	`actorEmail` varchar(320),
	`action` varchar(64) NOT NULL,
	`targetType` varchar(48),
	`targetId` varchar(64),
	`detail` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`key` varchar(64) NOT NULL,
	`value` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_config_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`company` varchar(255),
	`stage` varchar(64),
	`revenue` varchar(64),
	`why` text,
	`proofPoint` text,
	`consentAt` timestamp,
	`tierRequested` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'ascent',
	`status` enum('received','screening','interview','approved','rejected') NOT NULL DEFAULT 'received',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`decidedAt` timestamp,
	CONSTRAINT `applications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sessionId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`status` enum('attended','absent','excused') NOT NULL DEFAULT 'attended',
	`markedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`kind` enum('verify','reset') NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `award_cycles` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('draft','open','judging','announced','closed') NOT NULL DEFAULT 'draft',
	`level` enum('network','chapter','zone','region','country') NOT NULL DEFAULT 'network',
	`unitId` bigint unsigned,
	`opensAt` timestamp,
	`closesAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `award_cycles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `award_nominations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cycleId` bigint unsigned NOT NULL,
	`category` varchar(48) NOT NULL,
	`nomineeMemberId` bigint unsigned,
	`nomineeChapterId` bigint unsigned,
	`nominatedByMemberId` bigint unsigned,
	`citation` text,
	`status` enum('nominated','shortlisted','winner','declined') NOT NULL DEFAULT 'nominated',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `award_nominations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ballot_roll` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`electionId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ballot_roll_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ballots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`electionId` bigint unsigned NOT NULL,
	`candidateId` bigint unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ballots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `buddies` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`newMemberId` bigint unsigned NOT NULL,
	`buddyMemberId` bigint unsigned NOT NULL,
	`pairedAt` timestamp NOT NULL DEFAULT (now()),
	`checkinAt` timestamp,
	`note` varchar(500),
	CONSTRAINT `buddies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cadence_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cadenceId` bigint unsigned NOT NULL,
	`periodKey` varchar(16) NOT NULL,
	`status` enum('kept','rescheduled','missed') NOT NULL,
	`note` varchar(500),
	`actorMemberId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cadence_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cadences` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`type` varchar(48) NOT NULL,
	`title` varchar(128) NOT NULL,
	`frequency` varchar(16) NOT NULL,
	`ownerRole` varchar(48),
	`sop` varchar(16),
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cadences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`electionId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`statement` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `candidates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chapter_budgets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`label` varchar(255) NOT NULL,
	`kind` enum('allocation','sponsorship','spend') NOT NULL DEFAULT 'allocation',
	`amount` int NOT NULL,
	`category` varchar(48),
	`status` enum('proposed','approved','spent','rejected') NOT NULL DEFAULT 'proposed',
	`approvedByUserId` bigint unsigned,
	`note` text,
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_budgets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chapter_posts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`authorMemberId` bigint unsigned NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`url` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chapter_roles` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`role` varchar(64) NOT NULL,
	`title` varchar(128),
	`responsibilities` text,
	`electionId` bigint unsigned,
	`termStart` timestamp,
	`termEnd` timestamp,
	`onboardingMask` int NOT NULL DEFAULT 0,
	`status` enum('active','ended') NOT NULL DEFAULT 'active',
	`appointedBy` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chapter_transfers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`fromChapterId` bigint unsigned,
	`toChapterId` bigint unsigned NOT NULL,
	`note` varchar(500),
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`actorEmail` varchar(320),
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_transfers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`zoneId` bigint unsigned,
	`code` varchar(24),
	`country` varchar(128),
	`region` varchar(128),
	`state` varchar(128),
	`city` varchar(128),
	`zone` varchar(128),
	`meetingCadence` varchar(64),
	`status` enum('seed','provisional','chartered','mature','at_risk') NOT NULL DEFAULT 'seed',
	`charterDate` timestamp,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conduct_cases` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`reporterMemberId` bigint unsigned,
	`subjectMemberId` bigint unsigned,
	`chapterId` bigint unsigned,
	`category` varchar(64) NOT NULL,
	`severity` enum('low','moderate','high','safeguarding') NOT NULL DEFAULT 'moderate',
	`status` enum('open','reviewing','actioned','escalated','closed') NOT NULL DEFAULT 'open',
	`summary` varchar(255) NOT NULL,
	`detail` text,
	`handledByUserId` bigint unsigned,
	`resolution` text,
	`appealStatus` enum('none','open','upheld','reduced','reversed') NOT NULL DEFAULT 'none',
	`appealReason` text,
	`appealReviewerUserId` bigint unsigned,
	`appealOutcome` text,
	`appealedAt` timestamp,
	`appealDecidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conduct_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `council_decisions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unitId` bigint unsigned NOT NULL,
	`meetingId` bigint unsigned,
	`title` varchar(255) NOT NULL,
	`detail` text,
	`status` enum('proposed','carried','failed','deferred') NOT NULL DEFAULT 'proposed',
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `council_decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `council_meetings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unitId` bigint unsigned NOT NULL,
	`title` varchar(255) NOT NULL,
	`scheduledAt` timestamp,
	`status` enum('scheduled','held','cancelled') NOT NULL DEFAULT 'scheduled',
	`agenda` text,
	`minutes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `council_meetings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `data_requests` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`kind` enum('export','deletion') NOT NULL,
	`status` enum('open','done') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`tierGate` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'ascent',
	`postedBy` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dormancy_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`fromStage` varchar(32) NOT NULL,
	`toStage` varchar(32) NOT NULL,
	`reason` varchar(500),
	`actor` varchar(128) NOT NULL DEFAULT 'system',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dormancy_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `elections` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`title` varchar(255) NOT NULL,
	`seat` varchar(128) NOT NULL,
	`status` enum('open','voting','closed') NOT NULL DEFAULT 'open',
	`opensAt` timestamp,
	`closesAt` timestamp,
	`quorumPct` int NOT NULL DEFAULT 50,
	`resultHash` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `elections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `endorsements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`appId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`role` enum('qc','board') NOT NULL DEFAULT 'qc',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `endorsements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `engagement_config` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tier` enum('horizon','ascent','vanguard','zenith') NOT NULL,
	`sessionsRequired` int,
	`sessionsOffered` int,
	`oneToOnesPerQuarter` int,
	`giveBackPerYear` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `engagement_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `engagement_config_tier_unique` UNIQUE(`tier`)
);
--> statement-breakpoint
CREATE TABLE `event_feedback` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`eventId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`rating` int NOT NULL,
	`comment` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_regs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`eventId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`status` enum('registered','waitlisted','attended','cancelled') NOT NULL DEFAULT 'registered',
	`checkinCode` varchar(12),
	`guestOf` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_regs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`kind` enum('spark','meetup','circle','retreat','summit','conference','conclave','roundtable','workshop','masterclass','breakfast','lunch','dinner','social','webinar') NOT NULL DEFAULT 'meetup',
	`description` text,
	`startsAt` timestamp NOT NULL,
	`location` varchar(255),
	`tierGate` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'horizon',
	`audience` enum('public','members','tiers') NOT NULL DEFAULT 'members',
	`audienceTiers` varchar(128),
	`capacity` int NOT NULL DEFAULT 40,
	`cpdCredits` int NOT NULL DEFAULT 0,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned,
	`prospectId` bigint unsigned,
	`ownerUserId` bigint unsigned,
	`title` varchar(255) NOT NULL,
	`dueAt` timestamp,
	`status` enum('open','done','dismissed') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`doneAt` timestamp,
	CONSTRAINT `follow_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frp_cohorts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`tierGate` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'vanguard',
	`startsAt` timestamp,
	`status` enum('open','running','closed') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frp_cohorts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frp_enrolments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cohortId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`status` enum('enrolled','active','completed','withdrawn') NOT NULL DEFAULT 'enrolled',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frp_enrolments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frp_milestones` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`enrolmentId` bigint unsigned NOT NULL,
	`key` enum('deck','model','dataroom') NOT NULL,
	`status` enum('not_started','in_progress','submitted','reviewed') NOT NULL DEFAULT 'not_started',
	`note` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frp_milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gov_bodies` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gov_bodies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gov_minutes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`bodyId` bigint unsigned NOT NULL,
	`title` varchar(255) NOT NULL,
	`date` timestamp,
	`text` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gov_minutes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gov_roles` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`bodyId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`seat` varchar(128) NOT NULL,
	`termStart` timestamp,
	`termEnd` timestamp,
	CONSTRAINT `gov_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `health_snapshots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`total` int NOT NULL,
	`retention` int NOT NULL,
	`engagement` int NOT NULL,
	`growth` int NOT NULL,
	`programme` int NOT NULL,
	`leadership` int NOT NULL,
	`governance` int NOT NULL,
	`memberCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `health_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hive_score_config` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`factor` varchar(64) NOT NULL,
	`weight` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hive_score_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `hive_score_config_factor_unique` UNIQUE(`factor`)
);
--> statement-breakpoint
CREATE TABLE `hive_score_history` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`score` int NOT NULL,
	`breakdown` text,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hive_score_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`excerpt` varchar(500),
	`body` text,
	`tag` varchar(64) DEFAULT 'Note',
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `insights_id` PRIMARY KEY(`id`),
	CONSTRAINT `insights_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `investor_intros` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`investorName` varchar(255) NOT NULL,
	`firm` varchar(255),
	`memberId` bigint unsigned NOT NULL,
	`introducedBy` varchar(128) NOT NULL,
	`note` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investor_intros_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kpi_alerts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`scope` enum('network','chapter','zone','region','country') NOT NULL DEFAULT 'network',
	`scopeId` bigint unsigned,
	`metric` varchar(48) NOT NULL,
	`severity` enum('red','amber') NOT NULL DEFAULT 'red',
	`message` varchar(500) NOT NULL,
	`status` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`acknowledgedByEmail` varchar(320),
	`acknowledgedAt` timestamp,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kpi_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kpi_snapshots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`scope` enum('network','chapter','zone','region','country') NOT NULL DEFAULT 'network',
	`scopeId` bigint unsigned,
	`metric` varchar(48) NOT NULL,
	`value` int NOT NULL,
	`capturedOn` varchar(10) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kpi_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`form` varchar(64) NOT NULL,
	`email` varchar(320),
	`payload` text,
	`sourcePage` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`status` enum('new','contacted','qualified','won','lost') NOT NULL DEFAULT 'new',
	`ownerUserId` bigint unsigned,
	`notes` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`kind` enum('playbook','template','recording','note') NOT NULL DEFAULT 'playbook',
	`tierGate` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'horizon',
	`url` varchar(512),
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `library_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meeting_attendance` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`meetingId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`status` enum('present','absent','excused') NOT NULL DEFAULT 'present',
	CONSTRAINT `meeting_attendance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`kind` enum('chapter_meeting','board_meeting','huddle','other') NOT NULL DEFAULT 'chapter_meeting',
	`title` varchar(255) NOT NULL,
	`scheduledAt` timestamp,
	`status` enum('scheduled','held','cancelled') NOT NULL DEFAULT 'scheduled',
	`agenda` text,
	`minutes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meetings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `member_change_requests` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`category` enum('profile','tier','status','lifecycle','chapter') NOT NULL,
	`changes` text NOT NULL,
	`reason` varchar(500),
	`status` enum('pending','approved','rejected','applied','cancelled') NOT NULL DEFAULT 'pending',
	`source` enum('member','officer','admin') NOT NULL,
	`requestedByUserId` bigint unsigned NOT NULL,
	`requestedByEmail` varchar(320),
	`decidedByUserId` bigint unsigned,
	`decidedByEmail` varchar(320),
	`decisionNote` varchar(500),
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `member_change_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `member_kyc` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`idType` enum('emirates_id','passport','other'),
	`idNumber` varchar(64),
	`nationality` varchar(96),
	`idExpiry` timestamp,
	`status` enum('not_submitted','submitted','verified','rejected') NOT NULL DEFAULT 'not_submitted',
	`submittedAt` timestamp,
	`reviewedByUserId` bigint unsigned,
	`reviewedAt` timestamp,
	`reviewNote` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `member_kyc_id` PRIMARY KEY(`id`),
	CONSTRAINT `member_kyc_memberId_unique` UNIQUE(`memberId`)
);
--> statement-breakpoint
CREATE TABLE `member_save_cases` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`chapterId` bigint unsigned,
	`status` enum('open','working','saved','lost') NOT NULL DEFAULT 'open',
	`reason` varchar(255) NOT NULL,
	`ownerUserId` bigint unsigned,
	`stepsMask` int NOT NULL DEFAULT 0,
	`notes` text,
	`resolution` text,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `member_save_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`tier` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'horizon',
	`status` enum('active','paused','cancelled') NOT NULL DEFAULT 'active',
	`lifecycleState` enum('prospect','guest','applicant','onboarding','active','at_risk','renewal','lapsed','alumni','suspended') NOT NULL DEFAULT 'active',
	`hiveScore` int NOT NULL DEFAULT 0,
	`company` varchar(255),
	`title` varchar(255),
	`phone` varchar(64),
	`sector` varchar(128),
	`stage` varchar(64),
	`goals` varchar(500),
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`renewalAt` timestamp,
	`dormancyStage` enum('active','at_risk','dormant','non_renewal') NOT NULL DEFAULT 'active',
	`dormancyNote` varchar(500),
	`exceptionPause` int NOT NULL DEFAULT 0,
	`directoryVisible` int NOT NULL DEFAULT 1,
	`emailNotify` int NOT NULL DEFAULT 1,
	`inductionNo` int,
	`homeChapterId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `members_id` PRIMARY KEY(`id`),
	CONSTRAINT `members_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `membership_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`type` enum('approved','upgrade','downgrade','pause','cancel','renew') NOT NULL,
	`fromTier` varchar(32),
	`toTier` varchar(32),
	`note` text,
	`status` enum('applied','pending','approved','rejected') NOT NULL DEFAULT 'applied',
	`actorEmail` varchar(320),
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `membership_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `motion_votes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`motionId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`choice` enum('yes','no','abstain') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `motion_votes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `motions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chapterId` bigint unsigned NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`status` enum('open','passed','rejected') NOT NULL DEFAULT 'open',
	`closesAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `motions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `newsletters` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`issue` varchar(64),
	`url` varchar(512),
	`publishedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `newsletters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`text` varchar(500) NOT NULL,
	`kind` varchar(32) NOT NULL DEFAULT 'info',
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`vertical` enum('setup','consulting') NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`ctaUrl` varchar(512),
	`tierGate` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'horizon',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onboarding_milestones` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`milestone` varchar(48) NOT NULL,
	`note` varchar(500),
	`completedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onboarding_milestones_id` PRIMARY KEY(`id`),
	CONSTRAINT `onboarding_milestone_member_unique` UNIQUE(`memberId`,`milestone`)
);
--> statement-breakpoint
CREATE TABLE `one_to_ones` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`aMemberId` bigint unsigned NOT NULL,
	`bMemberId` bigint unsigned NOT NULL,
	`kind` enum('one_to_one','mentoring') NOT NULL DEFAULT 'one_to_one',
	`note` varchar(500),
	`status` enum('pending','confirmed','declined') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`confirmedAt` timestamp,
	CONSTRAINT `one_to_ones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `org_units` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`level` enum('zone','region','country') NOT NULL,
	`name` varchar(255) NOT NULL,
	`code` varchar(24),
	`parentId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `org_units_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_records` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'stripe',
	`providerRef` varchar(255),
	`purpose` varchar(32) NOT NULL DEFAULT 'membership',
	`tier` enum('horizon','ascent','vanguard','zenith'),
	`amount` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'aed',
	`status` enum('pending','paid','failed','refunded','partially_refunded') NOT NULL DEFAULT 'pending',
	`note` varchar(500),
	`refundedByUserId` bigint unsigned,
	`refundedAmount` int NOT NULL DEFAULT 0,
	`refundReason` varchar(500),
	`refundedAt` timestamp,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_records_provider_ref_unique` UNIQUE(`provider`,`providerRef`)
);
--> statement-breakpoint
CREATE TABLE `pod_members` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`podId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'member',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`confidentialityAt` timestamp,
	CONSTRAINT `pod_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pods` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`kind` enum('pod','mastermind') NOT NULL DEFAULT 'pod',
	`facilitator` varchar(255),
	`capacity` int NOT NULL DEFAULT 8,
	`cadence` varchar(128),
	`tierGate` enum('horizon','ascent','vanguard','zenith') NOT NULL DEFAULT 'horizon',
	`description` text,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `point_rules` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`factor` varchar(64) NOT NULL,
	`points` int NOT NULL,
	`label` varchar(255) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `point_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `point_rules_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `policy_acks` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`policyId` bigint unsigned NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policy_acks_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_acks_policy_member_unique` UNIQUE(`policyId`,`memberId`)
);
--> statement-breakpoint
CREATE TABLE `prospects` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`phone` varchar(40),
	`company` varchar(255),
	`chapterId` bigint unsigned,
	`stage` enum('prospect','guest','invited','converted','declined') NOT NULL DEFAULT 'prospect',
	`source` varchar(120),
	`notes` text,
	`ownerUserId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prospects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`endpoint` varchar(500) NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth` varchar(255) NOT NULL,
	`categories` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpoint_unique` UNIQUE(`endpoint`)
);
--> statement-breakpoint
CREATE TABLE `readiness_assessments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`enrolmentId` bigint unsigned NOT NULL,
	`team` int NOT NULL DEFAULT 0,
	`traction` int NOT NULL DEFAULT 0,
	`market` int NOT NULL DEFAULT 0,
	`financials` int NOT NULL DEFAULT 0,
	`narrative` int NOT NULL DEFAULT 0,
	`legal` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `readiness_assessments_id` PRIMARY KEY(`id`),
	CONSTRAINT `readiness_assessments_enrolmentId_unique` UNIQUE(`enrolmentId`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`prospectName` varchar(255) NOT NULL,
	`prospectContact` varchar(255),
	`note` varchar(500),
	`status` enum('submitted','converted','rejected') NOT NULL DEFAULT 'submitted',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `score_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`factor` varchar(64) NOT NULL,
	`points` int NOT NULL DEFAULT 0,
	`note` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `score_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_notes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sessionId` bigint unsigned NOT NULL,
	`summary` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `session_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_notes_sessionId_unique` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`podId` bigint unsigned NOT NULL,
	`startsAt` timestamp NOT NULL,
	`durationMin` int NOT NULL DEFAULT 90,
	`topic` varchar(255),
	`videoLink` varchar(512),
	`location` varchar(255),
	`status` enum('scheduled','done','cancelled') NOT NULL DEFAULT 'scheduled',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `unit_roles` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unitId` bigint unsigned NOT NULL,
	`level` enum('zone','region','country') NOT NULL,
	`memberId` bigint unsigned NOT NULL,
	`role` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `unit_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255),
	`consentAt` timestamp,
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`adminScopes` varchar(512) NOT NULL DEFAULT '',
	`emailVerifiedAt` timestamp,
	`totpSecret` varchar(64),
	`totpEnabled` int NOT NULL DEFAULT 0,
	`tokenVersion` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `zenith_apps` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`company` varchar(255),
	`proofPoint` text,
	`status` enum('nominated','endorsing','review','approved','rejected') NOT NULL DEFAULT 'nominated',
	`note` varchar(1000),
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `zenith_apps_id` PRIMARY KEY(`id`)
);
