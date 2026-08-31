CREATE TABLE IF NOT EXISTS `franchise_onboarding_checklists` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `chapterId` bigint unsigned NOT NULL,
  `itemKey` varchar(64) NOT NULL,
  `label` varchar(255) NOT NULL,
  `status` enum('pending','in_progress','done','skipped') NOT NULL DEFAULT 'pending',
  `assignedMemberId` bigint unsigned DEFAULT NULL,
  `dueAt` timestamp NULL DEFAULT NULL,
  `completedAt` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `ix_franchise_onboarding_chapter_key` (`chapterId`,`itemKey`),
  KEY `ix_franchise_onboarding_status` (`status`,`dueAt`),
  CONSTRAINT `franchise_onboarding_chapter_fk` FOREIGN KEY (`chapterId`) REFERENCES `chapters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `franchise_onboarding_member_fk` FOREIGN KEY (`assignedMemberId`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
