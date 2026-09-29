-- DropIndex
DROP INDEX "Stage_levelId_order_key";

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "branchKey" TEXT;

-- AlterTable
ALTER TABLE "Turn" ADD COLUMN     "stageType" "StageType";

-- CreateIndex
CREATE UNIQUE INDEX "Stage_levelId_order_branchKey_key" ON "Stage"("levelId", "order", "branchKey");

