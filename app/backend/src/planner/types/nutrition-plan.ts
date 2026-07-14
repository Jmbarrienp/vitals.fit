/**
 * Adaptive Nutrition Planner contract (Phase 2C.2). The planner is the platform's
 * STRATEGIC BRAIN: given the deterministic CoachingContext, it decides whether the
 * nutrition strategy should stay stable or evolve, and how. It is fully
 * deterministic — identical input always yields identical decisions. AI never
 * makes these decisions; at most a coach REPHRASES the deterministic explanation.
 *
 * Recommendations explain the present; the planner changes the future. It requires
 * LONGITUDINAL evidence (multiple ledger weeks) and never reacts to one bad day.
 *
 * Every vocabulary is pinned here (no @prisma imports) so the planner output is a
 * stable, model-agnostic contract that future consumers (Claude/GPT coach, push,
 * meal planning, grocery, workout planner) can depend on without schema knowledge.
 */

export const PLANNER_NAME = 'vitals-fit.adaptive-planner';
export const PLANNER_VERSION = 1;

/** The structured strategic decisions the planner can emit. */
export type PlanDecisionCode =
  | 'KEEP_PLAN'
  | 'REDUCE_CALORIES'
  | 'INCREASE_CALORIES'
  | 'MAINTAIN_PROTEIN'
  | 'INCREASE_PROTEIN'
  | 'REDUCE_PROTEIN'
  | 'CONTINUE_INTERVENTION'
  | 'REPLACE_INTERVENTION'
  | 'WAIT_FOR_MORE_DATA';

/** Which axis of the plan a decision concerns. */
export type PlanDimension = 'CALORIES' | 'PROTEIN' | 'INTERVENTION' | 'DATA';

export type PlanConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** The overall strategic posture for this cycle. */
export type PlanPosture =
  | 'STABLE' // nothing warrants a change; hold the plan
  | 'EVOLVING' // at least one dimension should change
  | 'ADHERENCE_FIRST' // a change looks tempting but consistency must come first
  | 'INSUFFICIENT_DATA'; // not enough longitudinal evidence to plan yet

/** A single, structured piece of evidence behind a decision (auditable). */
export interface PlanEvidence {
  code: string; // e.g. PLATEAU_SUSTAINED, HIGH_ADHERENCE, LOW_ADHERENCE, FAST_LOSS
  detail: string; // deterministic human detail, grounded in real numbers
}

/** The concrete numeric change a decision implies (grounded in current targets). */
export interface PlanAdjustment {
  calorieDelta?: number;
  newCalorieTarget?: number;
  proteinDelta?: number;
  newProteinTarget?: number;
}

export interface PlanDecision {
  code: PlanDecisionCode;
  dimension: PlanDimension;
  confidence: PlanConfidence;
  explanation: string; // deterministic; a coach MAY rephrase, never override
  evidence: PlanEvidence[];
  adjustment: PlanAdjustment | null; // null when the decision is not a numeric change
  reviewWindowDays: number; // when this decision should be reassessed
}

export interface NutritionPlan {
  meta: {
    planner: typeof PLANNER_NAME;
    version: number; // PLANNER_VERSION
    contractVersion: number; // CoachingContext version the plan was derived from
    weeksAnalyzed: number; // completed ledger weeks the decision rests on
    generatedAt: string; // ISO — informational only, NOT part of determinism
  };
  posture: PlanPosture;
  headline: PlanDecision; // the single most important decision this cycle
  decisions: PlanDecision[]; // all dimension decisions, headline included, ordered
  reviewWindowDays: number; // overall next reassessment window (headline's)
}
