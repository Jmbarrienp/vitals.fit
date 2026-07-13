-- Phase 2B.2: Weekly Behavioral Ledger — append-only historical snapshots.
-- Additive: one new table, existing tables untouched. Online-safe. ASCII-only
-- (embedded-postgres smoke uses WIN1252 on Windows).

CREATE TABLE "WeeklyNutritionSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "goalType" TEXT,
    "calorieTarget" INTEGER,
    "proteinTargetG" INTEGER,
    "adherenceScore" INTEGER,
    "nutritionScore" INTEGER,
    "trendStatus" TEXT,
    "plateauStatus" "PlateauStatus" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "behaviorFlags" "BehaviorFlag"[] DEFAULT ARRAY[]::"BehaviorFlag"[],
    "avgCalories" DOUBLE PRECISION,
    "avgProtein" DOUBLE PRECISION,
    "adherencePct" DOUBLE PRECISION,
    "daysLogged" INTEGER NOT NULL DEFAULT 0,
    "loggingStreak" INTEGER NOT NULL DEFAULT 0,
    "proteinStreakDays" INTEGER NOT NULL DEFAULT 0,
    "calorieStreakDays" INTEGER NOT NULL DEFAULT 0,
    "currentWeightKg" DOUBLE PRECISION,
    "weightTrendKgWk" DOUBLE PRECISION,
    "weightDataPoints" INTEGER NOT NULL DEFAULT 0,
    "generatedRecommendations" INTEGER NOT NULL DEFAULT 0,
    "acceptedRecommendations" INTEGER NOT NULL DEFAULT 0,
    "completedCommitments" INTEGER NOT NULL DEFAULT 0,
    "expiredCommitments" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION,
    "primaryIssue" TEXT,
    "primaryImprovement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyNutritionSnapshot_pkey" PRIMARY KEY ("id")
);

-- Append-only key: one immutable row per user per ISO week.
CREATE UNIQUE INDEX "WeeklyNutritionSnapshot_userId_weekStart_key" ON "WeeklyNutritionSnapshot"("userId", "weekStart");
CREATE INDEX "WeeklyNutritionSnapshot_userId_weekStart_idx" ON "WeeklyNutritionSnapshot"("userId", "weekStart");

ALTER TABLE "WeeklyNutritionSnapshot" ADD CONSTRAINT "WeeklyNutritionSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
