/**
 * Promotion execution plan contracts (Nutrition Vision V4.2) — the versioned
 * vocabulary of a promotion PLAN.
 *
 * What this slice is, and is not. It is NOT a decision-maker. Every statistical
 * judgment already has an owner — Learning evaluates, Calibration calibrates,
 * the Promotion policy tests significance, Governance recommends. The Executor
 * is a PURE CONSUMER: it reads those verdicts and assembles the operational
 * artifact a human needs to act on one — a rollout ladder, checklists, rollback
 * criteria — without recomputing a single number. If a value appears in this
 * plan, it was quoted, never derived here.
 *
 * And it EXECUTES nothing. It writes no configuration, flips no flag, changes
 * no provider. It builds a document. A human reads the document and decides.
 */

export const PROMOTION_PLAN_VERSION = 1;

/** Whether the plan is safe to act on — derived entirely from the owners' verdicts. */
export type PromotionReadiness = 'READY' | 'BLOCKED' | 'NOT_APPLICABLE';

export type ChecklistSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ChecklistStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';
export type ChecklistCategory = 'TECHNICAL' | 'OPERATIONAL' | 'STATISTICAL' | 'PRODUCT' | 'OBSERVABILITY' | 'SAFETY';
/** Who signs off. Not a person — a role, so the plan is portable across teams. */
export type ChecklistOwner = 'ENGINEERING' | 'ML' | 'OPERATIONS' | 'PRODUCT' | 'ON_CALL';

/** One checklist item — never a bare boolean: status, why, how bad, and who owns it. */
export interface ChecklistItem {
  category: ChecklistCategory;
  label: string;
  status: ChecklistStatus;
  explanation: string;
  severity: ChecklistSeverity;
  owner: ChecklistOwner;
}

/** One rung of the rollout ladder, every condition spelled out — never a naked percent. */
export interface RolloutStage {
  percent: number; // 5 | 10 | 25 | 50 | 100
  suggestedDurationHours: number;
  advanceConditions: string[]; // what must hold to move to the next rung
  stopConditions: string[]; // what pauses the rollout here (hold, don't revert)
  rollbackConditions: string[]; // what reverts to the incumbent immediately
}

/** One ordered operational step. Descriptive only — the platform performs none of them. */
export interface ExecutionStep {
  order: number;
  action: string;
  detail: string;
  owner: ChecklistOwner;
}

/** The statistical case, quoted VERBATIM from Governance — never re-tested here. */
export interface StatisticalEvidence {
  pairedScans: number;
  top1Delta: number | null;
  top1DeltaCi: { low: number; high: number } | null;
  mcNemarZ: number | null;
  generalizesAcrossModalities: boolean | null;
  generalizesAcrossUsers: boolean | null;
  incumbentDrift: string;
  /** the significance verdict the Governance owner already reached */
  governanceAction: string;
}

/** Risk, SUMMARIZED from the Risk Engine — never re-assessed. */
export interface RiskSummary {
  overall: string; // RiskLevel, verbatim
  dimensions: { dimension: string; level: string; topEvidence: string }[];
}

/**
 * The complete, deterministic promotion plan. Same inputs -> byte-identical
 * plan (a fixed `generatedAt` in, the same plan out — the field is an input,
 * not a clock read, precisely so the artifact is reproducible and auditable).
 */
export interface PromotionExecutionPlan {
  version: number;
  generatedAt: string; // ISO; supplied by the caller so the plan is reproducible

  currentProvider: string;
  candidateProvider: string | null;

  decision: string; // GovernanceAction, verbatim
  confidence: string; // a label derived from the CI width — see promotion-plan.ts
  readiness: PromotionReadiness;
  blockingReasons: string[]; // empty iff readiness === 'READY'

  statisticalEvidence: StatisticalEvidence;
  estimatedRisk: RiskSummary;

  rolloutStrategy: RolloutStage[];
  rolloutPercent: number; // the rung the plan starts at (0 when blocked)
  estimatedDurationHours: number; // sum of stage durations for a full ladder

  rollbackCriteria: string[]; // the union of every stage's rollback conditions
  rollbackSteps: ExecutionStep[];
  executionSteps: ExecutionStep[];

  monitoringChecklist: ChecklistItem[];
  validationChecklist: ChecklistItem[];
  approvalChecklist: ChecklistItem[];

  window: { from: Date; to: Date };
}
