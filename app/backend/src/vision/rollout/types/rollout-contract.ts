/**
 * Rollout contracts (Nutrition Vision V4.0) — the versioned vocabulary of the
 * Shadow Rollout + Trust Analytics platform.
 *
 * The rollout subsystem OBSERVES. It never controls, never rewrites history,
 * and owns no policy that already has an owner: Learning owns evaluation,
 * Promotion owns provider promotion, the Trust Engine owns runtime trust,
 * Vision owns recognition. Everything here is DERIVED from append-only data
 * (VisionScan, VisionFeedback, VisionTrustDecision) — no metric is stored
 * twice, no score can be hand-edited, and the same window always yields the
 * byte-identical report.
 */

export const ROLLOUT_CONTRACT_VERSION = 1;

/** Deployment stage of one modality/capability. Derived by deterministic rules — never set by hand. */
export type RolloutStage = 'DISABLED' | 'SHADOW' | 'READY' | 'LIMITED' | 'ROLLOUT' | 'FULL';

export interface ModalityRollout {
  modality: string; // PHOTO | BARCODE | LABEL_OCR | RESTAURANT | PORTION
  stage: RolloutStage;
  reasons: string[]; // why THIS stage, in measurable terms
  evidence: {
    configEnabled: boolean;
    autoAcceptEnabled: boolean;
    decisions: number;
    wouldAutoAccept: number; // shadow AUTO_ACCEPT decisions
    executed: number;
    undoneExecuted: number;
  };
}

export interface RolloutStatus {
  contractVersion: number;
  window: { from: Date; to: Date };
  generatedFor: { activeProviderId: string; autoAcceptEnabled: boolean };
  global: { stage: RolloutStage; reasons: string[] };
  perModality: ModalityRollout[];
  perProvider: { providerId: string; scans: number; stage: RolloutStage; reasons: string[] }[];
}

// ── Trust analytics ──────────────────────────────────────────────────────────

/** One derived trust aggregate. score is computed, never edited; inputs listed beside it. */
export interface TrustSlice {
  key: string;
  decisions: number;
  autoAcceptShare: number | null; // decided AUTO_ACCEPT / decisions
  executedShare: number | null;
  undoShare: number | null; // undone / executed (null when nothing executed)
  avgTrustScore: number | null;
  /** 0..1 — weighted blend of the above, formula pinned in trust-analytics.ts */
  score: number | null;
}

export interface TrustAnalytics {
  contractVersion: number;
  window: { from: Date; to: Date };
  overall: TrustSlice;
  perUser: TrustSlice[];
  perProvider: TrustSlice[];
  perModality: TrustSlice[]; // PHOTO / BARCODE / LABEL_OCR / RESTAURANT
  perFood: TrustSlice[];
  /** PORTION is a capability, not a modality: derived from EDITED_PORTION share in ground truth */
  portionTrust: { examples: number; editedShare: number | null; score: number | null };
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface HealthReport {
  contractVersion: number;
  window: { from: Date; to: Date };
  scans: number;
  acceptanceRate: number | null; // metrics.ts acceptance(), reused verbatim
  undoRate: number | null; // UNDONE scans / executed auto-accepts
  manualFallbackRate: number | null;
  providerFailureRate: number | null;
  meanLatencyMs: number | null;
  p50LatencyMs: number | null;
  meanScanConfidence: number | null;
  calibration: {
    currentEce: number | null;
    previousEce: number | null;
    drift: number | null; // |current − previous|; null when either window lacks data
  };
  promotion: { status: string; detail: string }; // verbatim from the Promotion owner, never recomputed
  /** auto-accepted then undone — the platform acted and was wrong */
  falsePositives: number;
  /** asked for review when the user then accepted everything unchanged — friction without cause */
  falseNegatives: number;
}

// ── Gates ────────────────────────────────────────────────────────────────────

export type GateStatus = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

/** A formal deployment gate. Never a bare boolean: every verdict explains itself. */
export interface RolloutGate {
  id: string; // AUTO_ACCEPT_READY | PROVIDER_READY | ROLLBACK_REQUIRED | PROMOTION_ALLOWED | PROMOTION_BLOCKED
  status: GateStatus;
  reasons: string[];
  evidence: Record<string, number | string | boolean | null>;
}

export interface GatesReport {
  contractVersion: number;
  window: { from: Date; to: Date };
  gates: RolloutGate[];
}

// ── Risk ─────────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskDimension {
  dimension: 'TECHNICAL' | 'USER' | 'BUSINESS' | 'MODEL' | 'OPERATIONAL';
  level: RiskLevel;
  evidence: string[]; // every claim carries its number
}

export interface RiskAssessment {
  contractVersion: number;
  window: { from: Date; to: Date };
  overall: RiskLevel; // max of dimensions — pessimistic by design
  dimensions: RiskDimension[];
}

// ── Timeline ─────────────────────────────────────────────────────────────────

/** One ISO-week bucket of append-only history. Recomputable from scratch forever. */
export interface TimelinePoint {
  weekStart: string; // YYYY-MM-DD (UTC Monday)
  decisions: number;
  autoAcceptShare: number | null;
  executed: number;
  undone: number;
  avgTrustScore: number | null;
  confirmations: number;
  corrections: number;
}

export interface TrustTimeline {
  contractVersion: number;
  window: { from: Date; to: Date };
  global: TimelinePoint[];
  perProvider: Record<string, TimelinePoint[]>;
  perModality: Record<string, TimelinePoint[]>;
}
