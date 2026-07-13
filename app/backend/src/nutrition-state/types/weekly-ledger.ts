import { BehaviorFlag, PlateauStatus } from '@prisma/client';

/**
 * Structured "what got better vs last week" codes (Phase 2B.2). A TS union (not a
 * Postgres enum) so the vocabulary grows without a migration — persisted as the
 * `primaryImprovement` String column, mirroring how RecommendationReason is stored.
 */
export type WeeklyImprovement =
  | 'ADHERENCE_IMPROVED'
  | 'NUTRITION_IMPROVED'
  | 'LOGGING_STREAK_IMPROVED'
  | 'PROTEIN_STREAK_IMPROVED'
  | 'WEIGHT_TREND_IMPROVED';

/**
 * Read-only projection of one ledger week for API/UI consumers. Every field is a
 * stored aggregate — reading this NEVER touches a raw meal row. `weekStart` is a
 * plain YYYY-MM-DD (the Monday, UTC).
 */
export interface WeeklyLedgerEntry {
  weekStart: string; // YYYY-MM-DD (Monday, UTC)
  isoYear: number;
  isoWeek: number;

  goalType: string | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;

  adherenceScore: number | null;
  nutritionScore: number | null;
  trendStatus: string | null;
  plateauStatus: PlateauStatus;
  behaviorFlags: BehaviorFlag[];

  avgCalories: number | null;
  avgProtein: number | null;
  adherencePct: number | null;
  daysLogged: number;

  loggingStreak: number;
  proteinStreakDays: number;
  calorieStreakDays: number;

  currentWeightKg: number | null;
  weightTrendKgWk: number | null;
  weightDataPoints: number;

  generatedRecommendations: number;
  acceptedRecommendations: number;
  completedCommitments: number;
  expiredCommitments: number;
  completionRate: number | null;

  primaryIssue: string | null; // RecommendationReason code
  primaryImprovement: WeeklyImprovement | null;
}
