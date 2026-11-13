ALTER TABLE "User" ADD COLUMN "marketingConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "marketingConsentRevokedAt" TIMESTAMP(3);
ALTER TABLE "Zone" ADD COLUMN "couponMinimumContributionPct" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "Booking" ADD COLUMN "couponCode" TEXT;
ALTER TABLE "Booking" ADD COLUMN "couponDiscount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "completedAt" TIMESTAMP(3);
UPDATE "Booking" SET "completedAt" = "createdAt" WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

CREATE TABLE "BookingVehicle" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  CONSTRAINT "BookingVehicle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BookingVehicle_bookingId_vehicleId_key" ON "BookingVehicle"("bookingId", "vehicleId");
CREATE INDEX "BookingVehicle_vehicleId_idx" ON "BookingVehicle"("vehicleId");
ALTER TABLE "BookingVehicle" ADD CONSTRAINT "BookingVehicle_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingVehicle" ADD CONSTRAINT "BookingVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingVehicle" ADD CONSTRAINT "BookingVehicle_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "BookingVehicle" ("id", "bookingId", "vehicleId", "serviceId", "price")
SELECT 'legacy_' || b."id", b."id", b."vehicleId", b."serviceId", b."price"
FROM "Booking" b WHERE b."vehicleId" IS NOT NULL
ON CONFLICT ("bookingId", "vehicleId") DO NOTHING;

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "zoneId" TEXT,
  "code" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "discountPct" DOUBLE PRECISION NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "redeemedAt" TIMESTAMP(3),
  "bookingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE UNIQUE INDEX "Coupon_bookingId_key" ON "Coupon"("bookingId");
CREATE INDEX "Coupon_userId_expiresAt_redeemedAt_idx" ON "Coupon"("userId", "expiresAt", "redeemedAt");
CREATE INDEX "Coupon_trigger_createdAt_idx" ON "Coupon"("trigger", "createdAt");
CREATE UNIQUE INDEX "Coupon_userId_trigger_key" ON "Coupon"("userId", "trigger");
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "keys" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "bookingId" TEXT,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationDelivery_dedupeKey_key" ON "NotificationDelivery"("dedupeKey");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_bookingId_channel_idx" ON "NotificationDelivery"("bookingId", "channel");
