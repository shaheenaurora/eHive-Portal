-- Membership gate affirmations for repositioned application flow.
-- Adds the applicant's identity/values affirmations to the applications table.
ALTER TABLE `applications` ADD `muslimIdentity` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `applications` ADD `valuesAligned` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `applications` ADD `affirmationNote` varchar(500);
