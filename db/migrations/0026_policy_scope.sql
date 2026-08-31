ALTER TABLE `policies`
  ADD COLUMN `scope` enum('global','chapter','zone','region','country') NOT NULL DEFAULT 'global',
  ADD COLUMN `scopeId` bigint unsigned DEFAULT NULL,
  ADD KEY `ix_policies_scope` (`scope`,`scopeId`);
