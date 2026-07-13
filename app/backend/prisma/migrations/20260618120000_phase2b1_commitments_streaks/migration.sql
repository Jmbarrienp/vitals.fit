-- Phase 2B.1: Retention and Behavior Engine slice 1 — Goal Commitments + Nutrition Streaks.
-- Additive only: new enum values, new nullable columns, new defaulted ints. Online-safe,
-- no backfill, no rewrite. ASCII-only (embedded-postgres smoke uses WIN1252 on Windows).

-- Commitment lifecycle states layered onto the existing recommendation status enum.
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'COMMITTED';
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- Commitment timestamps on Recommendation. The lifecycle is a state machine over these:
-- committedAt (PENDING->COMMITTED), commitExpiresAt (lazy sweep to EXPIRED), completedAt.
ALTER TABLE "Recommendation" ADD COLUMN "committedAt" TIMESTAMP(3);
ALTER TABLE "Recommendation" ADD COLUMN "commitExpiresAt" TIMESTAMP(3);
ALTER TABLE "Recommendation" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Consistency streaks, derived deterministically in recompute() (single source of truth).
-- loggingStreak already exists; these two are new.
ALTER TABLE "UserNutritionState" ADD COLUMN "proteinStreakDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserNutritionState" ADD COLUMN "calorieStreakDays" INTEGER NOT NULL DEFAULT 0;
