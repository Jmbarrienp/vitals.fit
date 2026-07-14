/**
 * CoachingContext — THE model-agnostic intelligence contract (Phase 2C.0).
 *
 * This is the single deterministic snapshot any LLM (Claude, GPT, Gemini, local)
 * consumes to coach a user. It is the anti-corruption boundary between the
 * platform and AI:
 *
 *   - It imports NOTHING from @prisma/client. Every vocabulary is pinned HERE,
 *     explicitly, so a database schema change can never silently change the
 *     contract. The builder (coaching-context.service) maps internal types in.
 *   - It carries AGGREGATES ONLY — never raw meal logs, never database ids,
 *     never the userId. A consumer needs zero knowledge of the schema.
 *   - It is versioned: consumers pin `meta.version` and evolution is explicit.
 *   - It is deterministic: same database state -> same contract (only
 *     `meta.generatedAt` varies, and it is informational).
 *
 * Retention metrics are deliberately EXCLUDED: they are product instrumentation
 * and must not influence coaching (2B.3 constraint).
 */

export const COACHING_CONTRACT_NAME = 'vitals-fit.coaching-context';
export const COACHING_CONTRACT_VERSION = 1;

// ── Pinned vocabularies (stable, small). The contract owns these words. ──
export type CtxGoal = 'lose' | 'maintain' | 'gain';
export type CtxPersona = 'beginner' | 'athlete' | 'busy' | 'returning' | 'expert';
export type CtxSex = 'male' | 'female' | 'other';
export type CtxTrend = 'on_track' | 'stalled' | 'regressing' | 'insufficient_data';
export type CtxPlateau = 'INSUFFICIENT_DATA' | 'NONE' | 'PLATEAU_SUSPECTED';
export type CtxBehaviorFlag =
  | 'PROTEIN_CHRONIC_LOW'
  | 'LOW_LOGGING_CONSISTENCY'
  | 'WEEKEND_OVEREATING'
  | 'BREAKFAST_SKIPPED';
export type CtxFollowUpBasis =
  | 'PERSISTENT_INTERVENED'
  | 'PERSISTENT_IGNORED'
  | 'NEW_ISSUE'
  | 'RESOLVED_NEXT'
  | 'MAINTAIN';
export type CtxIntervention = 'INTERVENED' | 'IGNORED' | 'NONE';

/**
 * Growable code vocabularies travel as plain strings (they expand without a
 * contract bump; consumers treat unknown codes as opaque labels):
 *  - reason / issue codes  -> RecommendationReason (e.g. PROTEIN_CHRONIC_LOW)
 *  - improvement codes     -> WeeklyImprovement (e.g. ADHERENCE_IMPROVED)
 */
export type CtxReasonCode = string;
export type CtxImprovementCode = string;

/** 'today' = high-frequency daily consumers (no history/review). 'full' = everything. */
export type ContextDepth = 'today' | 'full';

export interface CtxRecentMeal {
  name: string;
  calories: number;
  mealType: string; // breakfast | lunch | dinner | snack
}

/** One completed ISO week, straight from the immutable weekly ledger. */
export interface CtxWeek {
  weekStart: string; // YYYY-MM-DD (Monday, UTC)
  adherenceScore: number | null; // 0..100
  nutritionScore: number | null; // 0..100
  trendStatus: CtxTrend | null;
  plateauStatus: CtxPlateau;
  behaviorFlags: CtxBehaviorFlag[];
  daysLogged: number; // 0..7
  avgCalories: number | null;
  avgProtein: number | null;
  commitmentsCompleted: number;
  commitmentsExpired: number;
  primaryIssue: CtxReasonCode | null;
  primaryImprovement: CtxImprovementCode | null;
}

export interface CtxIssue {
  issue: CtxReasonCode;
  weeksActive: number;
  intervention: CtxIntervention; // was a matching recommendation committed/completed?
}

/** The last completed week's review + follow-up (null until a week completes). */
export interface CtxReview {
  weekStart: string;
  improvedMetrics: string[]; // metric names that materially improved vs prior week
  worsenedMetrics: string[];
  biggestOpportunity: CtxReasonCode | null;
  biggestImprovement: CtxImprovementCode | null;
  commitmentOutcomes: { reason: CtxReasonCode | null; status: 'COMPLETED' | 'EXPIRED' }[];
  followUp: {
    resolved: CtxIssue[];
    persisting: CtxIssue[];
    emerged: CtxIssue[];
  };
  nextPriority: { reason: CtxReasonCode; basis: CtxFollowUpBasis } | null;
}

/** A live pledge the user has made and not yet completed. */
export interface CtxCommitment {
  reason: CtxReasonCode | null;
  message: string; // the recommendation text the user committed to
  expiresAt: string; // ISO date — absolute, so the contract stays deterministic
}

export interface CoachingContext {
  meta: {
    contract: typeof COACHING_CONTRACT_NAME;
    version: number; // COACHING_CONTRACT_VERSION at build time
    depth: ContextDepth;
    generatedAt: string; // ISO — informational only, not part of determinism
    locale: string; // copy language for the end user (e.g. 'es')
  };

  user: {
    goal: CtxGoal;
    persona: CtxPersona;
    sex: CtxSex;
  };

  targets: {
    tdee: number;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };

  today: {
    caloriesLogged: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    mealsLogged: number;
    recentMeals: CtxRecentMeal[]; // up to 3, today only — today-state, not history
  };

  currentState: {
    computedAt: string; // ISO — when the rollup was derived
    adherenceScore: number | null; // 0..100
    nutritionScore: number | null; // 0..100
    trendStatus: CtxTrend | null;
    plateauStatus: CtxPlateau;
    behaviorFlags: CtxBehaviorFlag[];
    adherencePct7d: number | null; // 0..100
    daysLogged7d: number;
    avgCalories7d: number | null;
    streaks: { loggingDays: number; proteinDays: number; calorieDays: number };
    weight: { currentKg: number | null; trendKgPerWeek: number | null; dataPoints: number };
  };

  /** Newest-first completed weeks from the immutable ledger. Empty at depth 'today'. */
  history: { weeks: CtxWeek[] };

  /** Last completed week's review. Null at depth 'today' or before the first week closes. */
  review: CtxReview | null;

  commitments: { active: CtxCommitment[] };
}
