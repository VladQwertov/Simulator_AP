-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('CONTACT', 'DISCOVERY', 'PITCH', 'OBJECTION', 'CLOSING');

-- AlterTable
ALTER TABLE "Scenario" DROP COLUMN "opponentTone",
DROP COLUMN "opponentRole",
DROP COLUMN "opponentGoals",
DROP COLUMN "openingLine";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "state" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "Turn" ADD COLUMN "levelOrder" INTEGER,
ADD COLUMN "stageOrder" INTEGER,
ADD COLUMN "actionType" TEXT,
ADD COLUMN "actionQuality" INTEGER;

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "perLevelBreakdown" JSONB;

-- CreateTable
CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "opponentRole" TEXT NOT NULL,
    "opponentTone" TEXT NOT NULL,
    "opponentGoals" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "openingLine" TEXT NOT NULL,
    "maxRounds" INTEGER NOT NULL DEFAULT 6,
    "advanceThreshold" INTEGER NOT NULL DEFAULT 70,
    "failThreshold" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "StageType" NOT NULL,
    "title" TEXT,
    "description" TEXT,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Level_scenarioId_idx" ON "Level"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Level_scenarioId_order_key" ON "Level"("scenarioId", "order");

-- CreateIndex
CREATE INDEX "Stage_levelId_idx" ON "Stage"("levelId");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_levelId_order_key" ON "Stage"("levelId", "order");

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
