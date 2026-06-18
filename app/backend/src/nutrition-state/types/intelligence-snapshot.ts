import { BehaviorFlag, PlateauStatus } from '@prisma/client';

/**
 * Compact, READ-ONLY projection of longitudinal nutrition intelligence for the
 * mobile UI. Every field is copied straight from UserNutritionState (the single
 * source of truth) + the latest recommendation row. The client renders this as-is
 * and NEVER recomputes any of it.
 */
export interface IntelligenceSnapshot {
  computedAt: string;
  scores: {
    adherence: number | null; // 0..100 behavioral consistency (adherenceScore)
    nutrition: number | null; // 0..100 intake quality vs targets (nutritionScore)
  };
  trendStatus: string | null; // goal-aware: on_track | stalled | regressing | insufficient_data
  plateauStatus: PlateauStatus; // INSUFFICIENT_DATA | NONE | PLATEAU_SUSPECTED
  behaviorFlags: BehaviorFlag[]; // typed detected habits
  weekly: {
    daysLogged7d: number;
    avgCalories7d: number | null;
    avgCalories30d: number | null;
    calorieTarget: number | null;
    weightTrendKgWk: number | null;
    loggingStreak: number;
  };
  topRecommendation: {
    reason: string | null; // RecommendationReason code (structured)
    message: string;
    type: string;
    priority: string;
  } | null;
}
