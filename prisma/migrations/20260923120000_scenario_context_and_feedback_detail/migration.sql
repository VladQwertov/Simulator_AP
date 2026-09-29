-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN "playerRole" TEXT NOT NULL DEFAULT '',
ADD COLUMN "situation" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "stageBreakdown" JSONB,
ADD COLUMN "keyMomentQuote" TEXT,
ADD COLUMN "keyMomentExplanation" TEXT,
ADD COLUMN "betterAnswer" TEXT;
