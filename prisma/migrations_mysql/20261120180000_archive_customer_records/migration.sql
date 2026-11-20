ALTER TABLE `Vehicle` ADD COLUMN `deletedAt` DATETIME(3) NULL;
ALTER TABLE `Address` ADD COLUMN `deletedAt` DATETIME(3) NULL;
CREATE INDEX `Vehicle_customerId_deletedAt_idx` ON `Vehicle`(`customerId`, `deletedAt`);
CREATE INDEX `Address_customerId_deletedAt_idx` ON `Address`(`customerId`, `deletedAt`);
