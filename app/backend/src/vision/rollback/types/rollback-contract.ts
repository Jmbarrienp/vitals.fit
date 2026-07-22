/**
 * Safe rollback contracts (Nutrition Vision V4.3) — the versioned vocabulary of
 * a rollback PLAN.
 *
 * What this slice is, and is not. It is NOT a decision-maker: the question "is
 * something degrading right now?" already has an owner — the `ROLLBACK_REQUIRED`
 * gate (V4.0) fires when health leaves green or false positives spike, and the
 * Governance engine (V4.1) already detects incumbent drift and recommends
 * DEMOTE. The Rollback Engine is a PURE CONSUMER of those verdicts: it decides
 * WHICH safe lever to pull, HOW, and produces the auditable artifact a human
 * acts on. It recomputes no metric and re-tests no statistic.
 *
 * And it EXECUTES nothing. It writes no configuration, flips no flag, restores
 * no provider. It builds a document. A human reads it and acts.
 */

export const ROLLBACK_PLAN_VERSION = 1;

/** Is a rollback indicated, and can it be planned safely from live state alone? */
export type RollbackReadiness =
  | 'REQUIRED' // a trigger fired AND a deterministic safe target exists
  | 'BLOCKED' // a trigger fired but the target needs operator input (see the note on provider history)
  | 'NOT_REQUIRED'; // nothing is degrading

export type RollbackSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
/** How soon a human should act. Never a bare boolean. */
export type RollbackPriority = 'NONE' | 'MONITOR' | 'SCHEDULED' | 'IMMEDIATE';

/**
 * WHAT to restore. The platform has two autonomous levers that can degrade a
 * user's experience, and exactly one is fully recoverable from live state:
 *
 *   DISABLE_AUTO_ACCEPT  the V3.6 auto-accept behavior. Its known-safe state is
 *                        simply "off" (AUTO_ACCEPT_ENABLED=false — the shipped
 *                        default), so this target is fully deterministic.
 *   RESTORE_PROVIDER     a promoted VISION_PROVIDER. The platform persists no
 *                        promotion history, so the PRIOR provider is not
 *                        knowable from live state — the operator confirms the
 *                        last-known-good. A documented gap, not a fabricated
 *                        target (the same discipline as V4.1's unavailable
 *                        image-quality dimension).
 *   NONE                 nothing to roll back.
 */
export interface RollbackTarget {
  kind: 'DISABLE_AUTO_ACCEPT' | 'RESTORE_PROVIDER' | 'NONE';
  provider: string | null; // the safe floor for a provider rollback (fixture), or null
  detail: string;
}

export type ChecklistCategory = 'TECHNICAL' | 'OPERATIONAL' | 'PRODUCT' | 'MONITORING' | 'STATISTICAL' | 'SAFETY';
export type ChecklistStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';
export type ChecklistSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ChecklistOwner = 'ENGINEERING' | 'ML' | 'OPERATIONS' | 'PRODUCT' | 'ON_CALL';

export interface ChecklistItem {
  category: ChecklistCategory;
  label: string;
  status: ChecklistStatus;
  explanation: string;
  severity: ChecklistSeverity;
  owner: ChecklistOwner;
}

export interface RollbackStep {
  order: number;
  action: string;
  detail: string;
  owner: ChecklistOwner;
}

/** One triggering metric, quoted from its owner with the threshold it crossed. */
export interface TriggeringMetric {
  metric: string;
  observed: number | string | null;
  threshold: number | string | null;
  source: string; // which owner reported it
}

export interface RiskSummary {
  overall: string;
  dimensions: { dimension: string; level: string; topEvidence: string }[];
}

/**
 * The complete, deterministic rollback plan. `generatedAt` is an INPUT (not a
 * clock read) so the plan is a pure function of the owners' live verdicts:
 * same state + same timestamp -> byte-identical plan.
 */
export interface RollbackExecutionPlan {
  version: number;
  generatedAt: string;

  currentProvider: string;
  rollbackTarget: RollbackTarget;

  readiness: RollbackReadiness;
  rollbackReason: string; // the headline, in the user's language
  rollbackSeverity: RollbackSeverity;
  rollbackPriority: RollbackPriority;
  rollbackConfidence: string; // a label over how many independent signals agree — see rollback-plan.ts
  blockingReasons: string[]; // why the plan cannot be fully automated (empty unless BLOCKED)

  triggeringEvidence: string[]; // the owners' reasons, quoted
  triggeringMetrics: TriggeringMetric[];
  failedGates: { id: string; reasons: string[] }[];
  degradedHealth: string[]; // isHealthGreen()'s reasons, verbatim
  riskSummary: RiskSummary;

  rollbackSteps: RollbackStep[];
  verificationChecklist: ChecklistItem[]; // confirm the rollback worked
  postRollbackChecklist: ChecklistItem[]; // stabilize and learn
  monitoringPlan: string[]; // what to watch during recovery
  communicationPlan: string[]; // who to tell, and when
  retryConditions: string[]; // what must hold before attempting promotion again

  estimatedImpact: string[];
  rollbackWindow: { from: Date; to: Date };
}
