ALTER TABLE `scorecard_results` ADD CONSTRAINT `scorecard_results_leadId_fk` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_leadId_fk` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
