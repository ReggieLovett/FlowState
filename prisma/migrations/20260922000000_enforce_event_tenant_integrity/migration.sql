-- Tenant integrity for ScheduleEvent.
--
-- SubjectItem references Subject through a compound (subjectId, userId) foreign
-- key, so the database itself refuses an item filed under someone else's
-- subject. ScheduleEvent could not do the same. Its subject and item relations
-- are ON DELETE SET NULL, and a compound foreign key with SET NULL nulls every
-- column in the key, including userId. Postgres 15 can restrict that to one
-- column, but Prisma cannot express it. So those two relations are plain
-- single-column foreign keys, and "an event may only point at its own user's
-- subject and item" was enforced only by the application.
--
-- That application check is correct today (lib/data/schedule.ts), but it is a
-- rule every future write path has to remember. This trigger makes the database
-- enforce it regardless, so a missed check becomes an error instead of a row
-- that links one user's calendar to another user's data.
--
-- Checks run only for a column that is being *set*: on insert, or when the
-- reference or the owner changes. That is deliberate. Deleting a subject fires
-- several cascading actions (items deleted, event references nulled) in an
-- order Postgres does not promise; a trigger that re-validated every update
-- could run midway, find a half-deleted item, and abort a legitimate delete.
-- A reference being cleared to NULL never needs checking.

CREATE OR REPLACE FUNCTION "enforce_schedule_event_tenant"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."subjectId" IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
     )
     AND NOT EXISTS (
       SELECT 1 FROM "Subject" s
       WHERE s."id" = NEW."subjectId" AND s."userId" = NEW."userId"
     )
  THEN
    -- 23503 is foreign_key_violation, which Prisma surfaces as P2003.
    RAISE EXCEPTION 'ScheduleEvent.subjectId must reference a subject owned by the same user'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."itemId" IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NEW."itemId" IS DISTINCT FROM OLD."itemId"
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
     )
     AND NOT EXISTS (
       SELECT 1 FROM "SubjectItem" i
       WHERE i."id" = NEW."itemId" AND i."userId" = NEW."userId"
     )
  THEN
    RAISE EXCEPTION 'ScheduleEvent.itemId must reference an item owned by the same user'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

-- Both lookups are served by the existing @@unique([id, userId]) indexes, so a
-- 2,000-block generated plan costs 2,000 index probes, a few milliseconds.
CREATE TRIGGER "schedule_event_tenant_integrity"
  BEFORE INSERT OR UPDATE OF "userId", "subjectId", "itemId" ON "ScheduleEvent"
  FOR EACH ROW EXECUTE FUNCTION "enforce_schedule_event_tenant"();
