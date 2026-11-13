ALTER TABLE "Payment" ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "reconciliationSnapshot" JSONB;
ALTER TABLE "Payment" ADD COLUMN "reconciledAt" TIMESTAMP(3);

CREATE TABLE "CashfreeRefund" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "workerAdjustment" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'INITIATING',
  "cashfreeRefundId" TEXT,
  "statusDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashfreeRefund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CashfreeRefund_idempotencyKey_key" ON "CashfreeRefund"("idempotencyKey");
CREATE UNIQUE INDEX "CashfreeRefund_refundId_key" ON "CashfreeRefund"("refundId");
CREATE INDEX "CashfreeRefund_paymentId_createdAt_idx" ON "CashfreeRefund"("paymentId", "createdAt");
CREATE INDEX "CashfreeRefund_status_updatedAt_idx" ON "CashfreeRefund"("status", "updatedAt");
ALTER TABLE "CashfreeRefund" ADD CONSTRAINT "CashfreeRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
