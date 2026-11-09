-- Email and password auth plus Google sign-in
CREATE TYPE "AuthChallengeType" AS ENUM ('VERIFY_EMAIL', 'PASSWORD_RESET');
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "email" TEXT, ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "passwordHash" TEXT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "type" "AuthChallengeType" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AuthChallenge_email_type_createdAt_idx" ON "AuthChallenge"("email", "type", "createdAt");
