-- CreateEnum
CREATE TYPE "BehaviorFlag" AS ENUM ('PROTEIN_CHRONIC_LOW', 'LOW_LOGGING_CONSISTENCY', 'WEEKEND_OVEREATING', 'BREAKFAST_SKIPPED');

-- CreateEnum
CREATE TYPE "PlateauStatus" AS ENUM ('INSUFFICIENT_DATA', 'NONE', 'PLATEAU_SUSPECTED');

-- AlterTable
ALTER TABLE "UserNutritionState" ADD COLUMN     "adherenceScore" INTEGER,
ADD COLUMN     "behaviorFlags" "BehaviorFlag"[],
ADD COLUMN     "nutritionScore" INTEGER,
ADD COLUMN     "plateauStatus" "PlateauStatus" NOT NULL DEFAULT 'INSUFFICIENT_DATA';

