CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` bigint unsigned NOT NULL,
  `tokenVersion` int NOT NULL DEFAULT 0,
  `fingerprint` varchar(64) DEFAULT NULL,
  `ip` varchar(64) DEFAULT NULL,
  `userAgent` text DEFAULT NULL,
  `revokedAt` timestamp NULL DEFAULT NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_user_sessions_user` (`userId`),
  INDEX `ix_user_sessions_expires` (`expiresAt`),
  CONSTRAINT `user_sessions_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
