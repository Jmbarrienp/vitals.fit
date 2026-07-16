/**
 * Runtime trust contracts (Nutrition Vision V3.6) — the versioned vocabulary of
 * auto-accept graduation. Everything here is platform vocabulary: no vendor
 * types, no Prisma types, no model output.
 *
 * The truth boundary, restated for this slice: providers generate hypotheses,
 * users create ground truth, and the PLATFORM decides whether it has earned the
 * right to act on a hypothesis without asking. Trust is never granted, never
 * permanent, and never inferred by a model — it is computed from the user's own
 * confirmation history by pure functions, and it decays.
 */

/**
 * Bump when the trust/auto-accept policy changes shape or thresholds. Persisted
 * on every decision: an auto-accepted meal from six months ago must remain
 * explainable under the policy that actually produced it, not today's.
 */
export const TRUST_POLICY_VERSION = 1;

export type TrustLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * The graduation contexts the policy reasons about. Every decision carries the
 * signals that produced it — a trust decision the platform cannot explain is a
 * bug, not a feature.
 */
export type TrustSignal =
  | 'NEW_USER' // no history with this platform surface yet
  | 'KNOWN_USER' // the user has a track record
  | 'UNKNOWN_FOOD' // never confirmed by this user
  | 'KNOWN_FOOD' // confirmed before by this user
  | 'REPEATED_CONFIRMATIONS' // cleared the modality's confirmation minimum
  | 'HIGH_CONFIDENCE' // the provider reported high confidence
  | 'LOW_CONFIDENCE' // the provider reported low confidence
  | 'CALIBRATED_HIGH' // …and history says that confidence MEANS high
  | 'CALIBRATED_LOW' // …and history says that confidence over-promises
  | 'RECENT_UNDO' // catastrophic: the user reverted this recently
  | 'RECENT_CORRECTIONS' // the user keeps editing this
  | 'TRUST_DECAYED' // earned once, but too long ago
  | 'MODALITY_BARCODE' // exact identity — graduates earliest
  | 'MODALITY_OCR' // printed facts — graduates early
  | 'MODALITY_VISION' // inferred from appearance — graduates on evidence
  | 'MODALITY_RESTAURANT'; // unfamiliar kitchen — graduates last

/** What the user's own history says about this (user, food, modality). Read-only, never a model's opinion. */
export interface TrustEvidence {
  userId: string;
  foodItemId: string | null;
  modality: string; // ScanSource, or RESTAURANT for a restaurant-context photo
  /** ACCEPTED with no edit — the strongest positive signal */
  confirmations: number;
  /** EDITED_PORTION / SWAPPED — the platform was close but wrong */
  corrections: number;
  /** UNDONE — the platform acted and the user reverted it. Catastrophic. */
  undos: number;
  lastConfirmedAt: Date | null;
  lastUndoAt: Date | null;
  /** confirmations across ALL foods — distinguishes NEW_USER from UNKNOWN_FOOD */
  userTotalConfirmations: number;
}

export interface TrustDecision {
  policyVersion: number;
  level: TrustLevel;
  /** 0..1, deterministic: cumulative evidence, decayed by recency, penalized by undos */
  score: number;
  signals: TrustSignal[];
  reasons: string[]; // human-readable, deterministic, always measurable
  evidence: {
    confirmations: number;
    corrections: number;
    undos: number;
    daysSinceLastConfirmation: number | null;
    userTotalConfirmations: number;
  };
  /** the provider's confidence mapped through its own calibration curve (V3.5) */
  calibratedConfidence: number | null;
}

export type AutoAcceptAction = 'MANUAL_REVIEW' | 'REVIEW_REQUIRED' | 'AUTO_ACCEPT';

export interface AutoAcceptDecision {
  policyVersion: number;
  action: AutoAcceptAction;
  /** seconds the undo affordance stays prominent; 0 when nothing was auto-accepted */
  undoWindowSeconds: number;
  reason: string;
  signals: TrustSignal[];
  trust: TrustDecision;
  /**
   * True only when the platform WOULD auto-accept AND the feature is enabled.
   * With the flag off the decision is still computed, persisted and reported
   * (shadow mode) — the policy is validated on real traffic before it ever acts.
   */
  executed: boolean;
}

/** One persisted, append-only audit row — why the platform trusted itself. */
export interface TrustAuditRecord {
  scanId: string;
  userId: string;
  policyVersion: number;
  action: AutoAcceptAction;
  executed: boolean;
  trustLevel: TrustLevel;
  trustScore: number;
  calibratedConfidence: number | null;
  reportedConfidence: number | null;
  providerId: string;
  modality: string;
  signals: TrustSignal[];
  reasons: string[];
  createdAt: Date;
}

// ── Promotion executor (Subsystem 3) ─────────────────────────────────────────

export type PromotionRisk = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * A recommendation — never an action. Provider promotion stays OFFLINE and
 * human-approved: this subsystem consumes V3.5's PromotionDecision (it does not
 * recompute it) and dresses it with the operational context a human needs to
 * decide. Nothing here writes config, and nothing here can switch a provider.
 */
export interface PromotionRecommendation {
  policyVersion: number;
  incumbentId: string;
  challengerId: string;
  /** verbatim from V3.5's decidePromotion — the statistical verdict, unmodified */
  verdict: string;
  recommend: boolean;
  explanation: string;
  evidence: string[];
  risk: PromotionRisk;
  riskFactors: string[];
  impact: string[];
  checklist: string[];
  /** the challenger must be registered before a human could switch to it at all */
  challengerRegistered: boolean;
  activeProviderId: string;
}
