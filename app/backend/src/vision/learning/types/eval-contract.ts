/**
 * Evaluation contracts (Nutrition Vision V3.5) — the versioned vocabulary of the
 * Continuous Learning & Evaluation Engine. Everything a scorecard, calibration
 * report or promotion decision says is expressed in THESE types, never in
 * vendor terms and never in Prisma types.
 *
 * Ground-truth rule (non-negotiable): every label in this subsystem comes from
 * USERS — confirmations, edits, swaps, rejections, fallbacks. Never from a
 * model, never from a heuristic. The user is the supervisor; the platform is
 * the learner. Providers are temporary; this data is permanent.
 */

export const EVAL_CONTRACT_VERSION = 1;

/**
 * One labeled example: what a provider (through the pipeline) proposed for one
 * detection, versus what the user actually confirmed. Derived read-only from
 * VisionFeedback + the persisted proposal — building a dataset writes NOTHING.
 */
export interface GroundTruthExample {
  scanId: string;
  userId: string;
  providerId: string;
  providerVersion: string | null;
  source: string; // ScanSource
  detectionIndex: number; // -1 = user-added item, not tied to a detection
  action: string; // 'ACCEPTED' | 'EDITED_PORTION' | 'SWAPPED' | 'ADDED_MANUAL' | …
  proposedFoodItemId: string | null;
  confirmedFoodItemId: string | null;
  proposedGrams: number | null;
  confirmedGrams: number | null;
  proposedMethod: string | null;
  /** overall confidence of the proposed candidate at proposal time (null pre-V0 data loss) */
  candidateConfidence: number | null;
  /** alternate foodItemIds the proposal offered — powers top-3 accuracy */
  alternateFoodItemIds: string[];
  foodName: string | null; // displayName at proposal time — per-food breakdowns
  cuisineCategory: string | null; // restaurant category when the scan had context
  confirmedAt: Date | null;
}

/** One scan's terminal outcome — powers rate metrics that item examples can't. */
export interface ScanOutcome {
  scanId: string;
  userId: string;
  providerId: string;
  source: string;
  status: string; // terminal ScanStatus
  failureReason: string | null;
  scanConfidence: number | null;
  latencyMs: number | null; // null = recorded before V3.5 (UNMEASURED, never 0)
  tokensIn: number | null;
  tokensOut: number | null;
  proposedCandidateCount: number | null;
  confirmedItemCount: number;
  hadRestaurantContext: boolean;
  createdAt: Date;
}

export interface GroundTruthDataset {
  contractVersion: number;
  window: { from: Date; to: Date };
  providerId: string | null; // null = all providers
  examples: GroundTruthExample[];
  scans: ScanOutcome[];
}

/** A metric that may legitimately be unmeasurable: null means UNMEASURED, never zero. */
export type MaybeMetric = number | null;

export interface MetricSlice {
  n: number;
  top1Accuracy: MaybeMetric;
  medianPortionErrorPct: MaybeMetric;
}

/**
 * The full, versioned report card of one provider over one window of REAL
 * usage. Every number is deterministic given the dataset: same window, same
 * data -> byte-identical scorecard.
 */
export interface ProviderScorecard {
  contractVersion: number;
  providerId: string;
  window: { from: Date; to: Date };
  sampleSizes: { scans: number; examples: number; confirmedScans: number };

  // Recognition quality (identity)
  top1Accuracy: MaybeMetric;
  top3Accuracy: MaybeMetric;
  recognitionPrecision: MaybeMetric; // confirmed-from-candidates / proposed candidates
  recognitionRecall: MaybeMetric; // proposed / (proposed + user-added-manually)

  // Portion quality
  meanPortionErrorPct: MaybeMetric;
  medianPortionErrorPct: MaybeMetric;

  // Behavior / friction
  manualCorrectionRate: MaybeMetric; // EDITED_PORTION + SWAPPED over proposals
  fallbackRate: MaybeMetric;
  rejectRate: MaybeMetric;
  failureRate: MaybeMetric;
  providerAvailability: MaybeMetric; // 1 - provider-attributed failures

  // Modality acceptance (outcome proxies — documented as such)
  barcodeAcceptanceRate: MaybeMetric;
  ocrAcceptanceRate: MaybeMetric;
  restaurantContextAcceptanceRate: MaybeMetric;

  // Operations
  meanLatencyMs: MaybeMetric;
  p50LatencyMs: MaybeMetric;
  meanTokensPerScan: MaybeMetric; // cost proxy, provider-agnostic

  // Confidence honesty
  calibrationError: MaybeMetric; // ECE, from the calibration engine

  // Breakdowns — the "for which foods / users / cuisines / confidence" answers
  perFood: Record<string, MetricSlice>;
  perUser: Record<string, MetricSlice>;
  perCuisine: Record<string, MetricSlice>;
  perConfidenceBand: Record<string, MetricSlice>;
  perSource: Record<string, MetricSlice>;
}

// ── Calibration (Layer 3) ────────────────────────────────────────────────────

export interface CalibrationBin {
  lower: number; // inclusive
  upper: number; // exclusive (last bin inclusive)
  n: number;
  meanReportedConfidence: MaybeMetric;
  empiricalAccuracy: MaybeMetric; // identity-held rate among examples in the bin
}

/** The reusable calibration interface every future provider plugs into unchanged. */
export interface CalibrationCurve {
  contractVersion: number;
  providerId: string;
  builtFrom: { examples: number; window: { from: Date; to: Date } };
  bins: CalibrationBin[];
}

export interface CalibrationReport {
  curve: CalibrationCurve;
  /** Expected Calibration Error: sum over bins of (n_b/N)·|accuracy_b − confidence_b| */
  expectedCalibrationError: MaybeMetric;
  overconfident: boolean | null; // reported confidence systematically above accuracy
}

// ── Promotion (Layer 4) ──────────────────────────────────────────────────────

export type PromotionVerdict = 'PROMOTE_CHALLENGER' | 'KEEP_INCUMBENT' | 'INSUFFICIENT_DATA';

export interface PromotionDecision {
  contractVersion: number;
  incumbentId: string;
  challengerId: string;
  verdict: PromotionVerdict;
  /** every reason is a measurable statement — promotion is data-driven, never opinion-driven */
  reasons: string[];
  zScoreTop1: MaybeMetric; // two-proportion z on top-1 accuracy
}

export interface ProviderComparison {
  contractVersion: number;
  incumbent: ProviderScorecard;
  challenger: ProviderScorecard;
  decision: PromotionDecision;
}

// ── Historical replay (Layer 2) ──────────────────────────────────────────────

/**
 * Replay re-runs the CURRENT deterministic pipeline over STORED detections and
 * compares against ground truth — read-only by contract. It cannot re-run a
 * vision provider over historical user photos: images are ephemeral BY DESIGN
 * (privacy over replayability). Cross-provider comparison therefore uses each
 * provider's own-production scorecard plus the synthetic eval harness corpus.
 */
export interface ReplayReport {
  contractVersion: number;
  scansReplayed: number;
  examplesCompared: number;
  top1Accuracy: MaybeMetric;
  medianPortionErrorPct: MaybeMetric;
  /** two identical passes produced identical metrics — the determinism guarantee, measured */
  deterministic: boolean;
}
