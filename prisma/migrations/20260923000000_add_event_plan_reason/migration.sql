-- The planner's one-sentence explanation for a generated block, shown on hover.
-- Nullable with no default, so existing rows need no backfill and the column
-- costs nothing for hand-made events.
ALTER TABLE "ScheduleEvent" ADD COLUMN "planReason" TEXT;
