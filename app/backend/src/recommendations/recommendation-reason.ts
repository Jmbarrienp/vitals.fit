import { BehaviorFlag, PlateauStatus, Priority, RecommendationType } from '@prisma/client';

/**
 * Structured "why" behind every recommendation. This is the single, typed
 * vocabulary the whole recommendation surface speaks — the foundation for
 * Dashboard Intelligence, Weekly Insights and (later) the Claude Coach.
 *
 * It is a TS enum (not a Prisma enum) on purpose: the reason space GROWS with
 * every new insight, and a Postgres enum would force a migration per addition.
 * It is persisted as a String column (`Recommendation.reason`) whose only writer
 * is this engine, so it stays structured + queryable without that friction.
 */
export enum RecommendationReason {
  // ── plan-adjustment channel (weight-driven, may change the calorie target) ──
  PLATEAU_SUSPECTED = 'PLATEAU_SUSPECTED',
  LOSING_TOO_FAST = 'LOSING_TOO_FAST',
  GAIN_STALLED = 'GAIN_STALLED',

  // ── longitudinal nudges (consumers of behaviorFlags) ──
  PROTEIN_CHRONIC_LOW = 'PROTEIN_CHRONIC_LOW',
  WEEKEND_DRIFT = 'WEEKEND_DRIFT',
  BREAKFAST_SKIPPED = 'BREAKFAST_SKIPPED',
  LOW_LOGGING_CONSISTENCY = 'LOW_LOGGING_CONSISTENCY',
  LOW_ADHERENCE_WEEK = 'LOW_ADHERENCE_WEEK',

  // ── today-state nudges ──
  NO_MEALS_LOGGED = 'NO_MEALS_LOGGED',
  OVER_TARGET = 'OVER_TARGET',
  TARGET_REACHED = 'TARGET_REACHED',
  PROTEIN_GAP_TODAY = 'PROTEIN_GAP_TODAY',
  CALORIES_REMAINING = 'CALORIES_REMAINING',

  // ── reinforcement ──
  STREAK_MILESTONE = 'STREAK_MILESTONE',
  TREND_ON_TRACK = 'TREND_ON_TRACK',
  STEADY = 'STEADY',
}

/** Reason → persisted RecommendationType + Priority. One place, no scattered casts. */
export const REASON_META: Record<
  RecommendationReason,
  { type: RecommendationType; priority: Priority }
> = {
  [RecommendationReason.PLATEAU_SUSPECTED]: { type: RecommendationType.PLAN_ADJUSTMENT, priority: Priority.HIGH },
  [RecommendationReason.LOSING_TOO_FAST]: { type: RecommendationType.ALERT, priority: Priority.HIGH },
  [RecommendationReason.GAIN_STALLED]: { type: RecommendationType.PLAN_ADJUSTMENT, priority: Priority.MEDIUM },

  [RecommendationReason.PROTEIN_CHRONIC_LOW]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.MEDIUM },
  [RecommendationReason.WEEKEND_DRIFT]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.MEDIUM },
  [RecommendationReason.BREAKFAST_SKIPPED]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.LOW },
  [RecommendationReason.LOW_LOGGING_CONSISTENCY]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.MEDIUM },
  [RecommendationReason.LOW_ADHERENCE_WEEK]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.HIGH },

  [RecommendationReason.NO_MEALS_LOGGED]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.LOW },
  [RecommendationReason.OVER_TARGET]: { type: RecommendationType.EDUCATIONAL, priority: Priority.LOW },
  [RecommendationReason.TARGET_REACHED]: { type: RecommendationType.REINFORCEMENT, priority: Priority.LOW },
  [RecommendationReason.PROTEIN_GAP_TODAY]: { type: RecommendationType.BEHAVIOR_RECOMMENDATION, priority: Priority.MEDIUM },
  [RecommendationReason.CALORIES_REMAINING]: { type: RecommendationType.EDUCATIONAL, priority: Priority.LOW },

  [RecommendationReason.STREAK_MILESTONE]: { type: RecommendationType.MILESTONE, priority: Priority.LOW },
  [RecommendationReason.TREND_ON_TRACK]: { type: RecommendationType.REINFORCEMENT, priority: Priority.LOW },
  [RecommendationReason.STEADY]: { type: RecommendationType.REINFORCEMENT, priority: Priority.LOW },
};

/** A single, fully-typed recommendation. The only output shape of the engine. */
export interface StructuredRecommendation {
  reason: RecommendationReason;
  message: string;
  type: RecommendationType;
  priority: Priority;
  /** Only set by the plan-adjustment channel; applied via /recommendations/:id/respond. */
  calorieAdjustment?: number;
  requiresConfirmation: boolean;
}

/**
 * Flat, read-only input to the engine. Every field is sourced from
 * UserNutritionState (the rollup) + today's intake + goal targets — the engine
 * NEVER recomputes a metric. Both the event listeners and the HTTP path build
 * this and hand it in.
 */
export interface RecommendationInput {
  goal: 'lose' | 'gain' | 'maintain';
  targets: { calories: number; proteinG: number };
  today: { caloriesLogged: number; proteinG: number; mealsLogged: number };
  state: {
    plateauStatus: PlateauStatus;
    behaviorFlags: BehaviorFlag[];
    trendStatus: string | null;
    adherenceScore: number | null;
    adherencePct7d: number;
    loggingStreak: number;
    weightTrendKgWk: number | null;
    weightDataPoints: number;
  };
}
