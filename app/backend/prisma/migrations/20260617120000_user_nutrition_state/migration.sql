-- CreateTable
CREATE TABLE "UserNutritionState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "goalType" TEXT,
    "calorieTarget" INTEGER,
    "proteinTargetG" INTEGER,
    "avgCalories7d" DOUBLE PRECISION,
    "avgCalories30d" DOUBLE PRECISION,
    "avgProtein7d" DOUBLE PRECISION,
    "adherencePct7d" DOUBLE PRECISION,
    "loggingStreak" INTEGER NOT NULL DEFAULT 0,
    "daysLogged7d" INTEGER NOT NULL DEFAULT 0,
    "daysLogged30d" INTEGER NOT NULL DEFAULT 0,
    "avgMealsPerDay" DOUBLE PRECISION,
    "currentWeightKg" DOUBLE PRECISION,
    "weightTrendKgWk" DOUBLE PRECISION,
    "weightDataPoints" INTEGER NOT NULL DEFAULT 0,
    "trendStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNutritionState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNutritionState_userId_key" ON "UserNutritionState"("userId");

-- CreateIndex
CREATE INDEX "UserNutritionState_stale_idx" ON "UserNutritionState"("stale");

-- AddForeignKey
ALTER TABLE "UserNutritionState" ADD CONSTRAINT "UserNutritionState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

