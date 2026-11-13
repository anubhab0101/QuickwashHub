ALTER TABLE "User" ADD COLUMN "adminMfaSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "adminMfaPendingSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "adminMfaPendingExpiresAt" TIMESTAMP(3);
