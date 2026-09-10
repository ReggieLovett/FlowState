-- AlterTable
ALTER TABLE "Subject" DROP COLUMN "isSeeded",
ADD COLUMN     "seedKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subject_userId_seedKey_key" ON "Subject"("userId", "seedKey");

