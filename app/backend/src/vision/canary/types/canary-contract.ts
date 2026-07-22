/**
 * Progressive canary rollout contracts (Nutrition Vision V4.4) — the versioned
 * vocabulary of a canary PROGRESSION recommendation.
 *
 * What this slice is, and is not. It is NOT a decision-maker and NOT a
 * controller. The rollout LADDER already exists (the Promotion Executor's
 * `rolloutStrategy`, V4.2). The ABORT signal already exists (the Rollback
 * Engine's readiness/priority, V4.3). The Canary Engine is a PURE CONSUMER of
 * both: given where a rollout currently sits, it recommends the next MOVE —
 * advance, stay, hold, pause, roll back, or complete — and explains why. It
 * recomputes no metric, re-tests no statistic, and re-derives no ladder.
 *
 * And it AUTOMATES nothing. "Automation" here means the progression LOGIC is
 * deterministic and machine-checkable, not that the machine acts: it writes no
 * configuration, advances no traffic, flips no flag. A human reads the
 * recommendation and moves the rollout.
 *
 * The knowability boundary (same discipline as V4.1/V4.3): the platform
 * persists no live canary state (no rollout-state table; this slice adds no
 * migration). So the CURRENT position is an input the operator supplies
 * (`atPercent`), and the engine deterministically advises the next move from
 * it. Absent an input, it evaluates the START of the canary.
 */

export const CANARY_PLAN_VERSION = 1;

/**
 * The recommended next move. Never a bare enum in the wire — every plan pairs
 * this with an explanation and the conditions behind it.
 *   ADVANCE   signals support moving to the next rung
 *   STAY      clear to hold position, but a cautionary signal says keep observing
 *   HOLD      cannot proceed — no viable promotion to canary
 *   PAUSE     a mild degradation is present; contain and watch, do not advance
 *   ROLLBACK  a real degradation fired; abort (defer to the Rollback plan)
 *   COMPLETE  at 100% and stable — the canary is done
 */
export type CanaryRecommendation = 'ADVANCE' | 'STAY' | 'HOLD' | 'PAUSE' | 'ROLLBACK' | 'COMPLETE';

export type CanaryReadiness = 'READY_TO_ADVANCE' | 'HOLDING' | 'ABORTING' | 'COMPLETED';

/** One rung of the canary timeline — consumed from the Promotion plan's ladder, never rebuilt. */
export interface CanaryStage {
  percent: number;
  suggestedDurationHours: number;
  advanceConditions: string[];
  stopConditions: string[];
  rollbackConditions: string[];
  /** where the rollout is relative to this rung */
  position: 'PAST' | 'CURRENT' | 'FUTURE';
  /** the live indicators observed for the CURRENT rung (empty for past/future rungs) */
  observedIndicators: string[];
}

/** A verdict paired with its explanation — the "never a bare boolean" rule. */
export interface CanarySignal {
  value: boolean;
  explanation: string;
}

export type ChecklistCategory = 'TECHNICAL' | 'OPERATIONAL' | 'MONITORING' | 'STATISTICAL' | 'SAFETY';
export type ChecklistStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';
export type ChecklistSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ChecklistOwner = 'ENGINEERING' | 'ML' | 'OPERATIONS' | 'ON_CALL';

export interface ChecklistItem {
  category: ChecklistCategory;
  label: string;
  status: ChecklistStatus;
  explanation: string;
  severity: ChecklistSeverity;
  owner: ChecklistOwner;
}

export interface RiskSummary {
  overall: string;
  dimensions: { dimension: string; level: string; topEvidence: string }[];
}

/**
 * The complete, deterministic canary progression plan. `generatedAt` is an
 * INPUT (not a clock read), so the plan is a pure function of the owners' live
 * verdicts plus the supplied position: same state + same position + same
 * timestamp -> byte-identical plan.
 */
export interface CanaryRolloutPlan {
  version: number;
  generatedAt: string;

  /** the operator-supplied current position; 0 = pre-rollout */
  rolloutPercent: number;
  currentStage: CanaryStage | null; // null when pre-rollout (below the first rung)
  nextStage: CanaryStage | null; // null when at 100%

  recommendation: CanaryRecommendation;
  recommendationReason: string;
  readiness: CanaryReadiness;

  /** the three move signals, each explained (never bare booleans) */
  advanceRecommendation: CanarySignal;
  holdRecommendation: CanarySignal;
  rollbackRecommendation: CanarySignal;

  /** what must hold to advance (the current rung's advanceConditions, consumed) */
  requiredConditions: string[];
  /** what currently blocks advancing (stop conditions + any live blockers) */
  blockingConditions: string[];

  monitoringChecklist: ChecklistItem[];
  verificationChecklist: ChecklistItem[];

  /** pointers to the plans this consumes — never a copy of their internals */
  promotionReference: { readiness: string; decision: string; candidateProvider: string | null };
  rollbackReference: { readiness: string; severity: string; priority: string };

  estimatedExposure: { currentPercent: number; nextPercent: number | null; detail: string };
  estimatedRisk: RiskSummary;

  /** the full ladder, positioned — consumed from the Promotion plan, not rebuilt */
  timeline: CanaryStage[];

  window: { from: Date; to: Date };
}
