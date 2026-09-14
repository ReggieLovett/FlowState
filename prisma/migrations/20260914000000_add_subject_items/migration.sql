-- Sub-items inside subjects, and a link from calendar blocks to the item they
-- work on. Additive only: existing rows need no backfill, and itemId stays
-- NULL for every block that was not planned from an item.

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('TASK', 'ASSIGNMENT', 'PROJECT', 'EXAM');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('TODO', 'DONE');

-- AlterTable
ALTER TABLE "ScheduleEvent" ADD COLUMN     "itemId" TEXT;

-- CreateTable
CREATE TABLE "SubjectItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ItemType" NOT NULL DEFAULT 'TASK',
    "status" "ItemStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectItem_userId_subjectId_idx" ON "SubjectItem"("userId", "subjectId");

-- CreateIndex
CREATE INDEX "SubjectItem_userId_status_dueDate_idx" ON "SubjectItem"("userId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectItem_id_userId_key" ON "SubjectItem"("id", "userId");

-- CreateIndex
CREATE INDEX "ScheduleEvent_userId_itemId_idx" ON "ScheduleEvent"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "SubjectItem" ADD CONSTRAINT "SubjectItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectItem" ADD CONSTRAINT "SubjectItem_subjectId_userId_fkey" FOREIGN KEY ("subjectId", "userId") REFERENCES "Subject"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SubjectItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

