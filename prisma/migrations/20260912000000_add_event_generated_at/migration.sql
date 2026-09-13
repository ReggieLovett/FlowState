-- Marks rows created by the smart scheduling engine.
--
-- Nullable and additive: existing rows stay NULL, which is exactly the
-- "entered by hand" case, so no backfill is needed.
-- AlterTable
ALTER TABLE "ScheduleEvent" ADD COLUMN "generatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ScheduleEvent_userId_generatedAt_idx" ON "ScheduleEvent"("userId", "generatedAt");
