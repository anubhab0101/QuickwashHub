ALTER TABLE "Worker" ADD COLUMN "cashfreeVendorId" TEXT;
ALTER TABLE "Worker" ADD COLUMN "solarQualified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "paymentSessionId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "splitStatus" TEXT NOT NULL DEFAULT 'NOT_READY';
ALTER TABLE "Payment" ADD COLUMN "splitUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Zone" ADD COLUMN "centerLat" DOUBLE PRECISION;
ALTER TABLE "Zone" ADD COLUMN "centerLng" DOUBLE PRECISION;
ALTER TABLE "Zone" ADD COLUMN "radiusKm" DOUBLE PRECISION;
CREATE TYPE "ServiceCategory" AS ENUM ('VEHICLE', 'SOLAR', 'HOME');
ALTER TABLE "Service" ADD COLUMN "category" "ServiceCategory" NOT NULL DEFAULT 'VEHICLE';
ALTER TABLE "Service" ALTER COLUMN "vehicleType" DROP NOT NULL;
ALTER TABLE "ZonePrice" ADD COLUMN "solarPanelTier" TEXT;
ALTER TABLE "ZonePrice" ALTER COLUMN "vehicleType" DROP NOT NULL;
DROP INDEX "ZonePrice_zoneId_serviceId_vehicleType_key";
CREATE UNIQUE INDEX "ZonePrice_zoneId_serviceId_vehicleType_solarPanelTier_key" ON "ZonePrice"("zoneId", "serviceId", "vehicleType", "solarPanelTier");
ALTER TABLE "Booking" ALTER COLUMN "vehicleId" DROP NOT NULL;
ALTER TABLE "Booking" ADD COLUMN "solarPanelCount" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "solarRoofType" TEXT;
ALTER TABLE "Booking" ADD COLUMN "solarAccessNotes" TEXT;
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'QUOTE_REQUESTED';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'QUOTE_PROVIDED';
ALTER TABLE "Booking" ADD COLUMN "solarPropertyType" TEXT;
ALTER TABLE "Booking" ADD COLUMN "quoteNote" TEXT;
INSERT INTO "Service" ("id", "name", "category", "vehicleType", "durationMin", "isActive") VALUES ('qwh_solar_panel_wash', 'Solar Panel Wash', 'SOLAR', NULL, 90, true) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "Service" ("id", "name", "category", "vehicleType", "durationMin", "isActive") VALUES ('qwh_home_wash', 'Home Wash', 'HOME', NULL, 120, false) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicket_reference_key" ON "SupportTicket"("reference");
CREATE INDEX "SupportTicket_customerId_createdAt_idx" ON "SupportTicket"("customerId", "createdAt");
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
CREATE INDEX "AccountDeletionRequest_userId_createdAt_idx" ON "AccountDeletionRequest"("userId", "createdAt");
CREATE INDEX "AccountDeletionRequest_status_createdAt_idx" ON "AccountDeletionRequest"("status", "createdAt");
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
