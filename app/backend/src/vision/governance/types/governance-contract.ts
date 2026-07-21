/**
 * Provider governance contracts (Nutrition Vision V4.1) — the versioned
 * vocabulary of live, paired provider comparison.
 *
 * THE PROBLEM V4.1 EXISTS TO SOLVE. V3.5's `compare()` scores each provider on
 * ITS OWN production traffic: different scans, different users, different
 * foods, different lighting. That is an OBSERVATIONAL comparison — if the
 * incumbent ran during a month of packaged foods and the challenger during
 * restaurant season, the numbers describe the traffic, not the providers.
 *
 * V4.1 adds the PAIRED comparison: both providers scored on the SAME scan,
 * against the SAME user confirmation as the label. Same input, same truth, so
 * the difference is attributable to the provider. That is the only evidence on
 * which a promotion should ever rest.
 *
 * Everything here is read-only, derived from append-only evidence, versioned,
 * and explainable. Production always runs ONE provider per modality: shadow
 * runs never reach the user, never vote, and never enter the write path.
 */

export const GOVERNANCE_CONTRACT_VERSION = 1;

/** Terminal state of one shadow challenger call. Append-only evidence, never mutated. */
export type ShadowRunStatus = 'COMPLETED' | 'FAILED';

/**
 * How one provider did on ONE scan, judged against what the user confirmed.
 * `null` means unmeasurable for this scan (never zero, never invented).
 */
export interface SideOutcome {
  /** the provider's top candidate matched what the user confirmed */
  top1Hit: boolean;
  /** confirmed item appeared as the top candidate OR among its alternates */
  top3Hit: boolean;
  /** proposed a different food than the user confirmed — a wrong identity, not a miss */
  swapped: boolean;
  /** proposed nothing that could be matched to the confirmed food at all */
  missed: boolean;
  /** |proposed − confirmed| / confirmed, when both grams exist */
  portionErrorPct: number | null;
  /** the provider's own reported confidence for its top candidate */
  reportedConfidence: number | null;
}

/** One scan judged for BOTH providers — the unit of paired evidence. */
export interface PairedOutcome {
  scanId: string;
  userId: string;
  source: string; // modality
  foodName: string | null;
  cuisine: string | null;
  /** band of the INCUMBENT's confidence — the production-visible signal */
  confidenceBand: 'LOW' | 'MEDIUM' | 'HIGH';
  confirmedFoodItemId: string;
  incumbent: SideOutcome;
  challenger: SideOutcome;
}

/** Aggregate quality over a set of paired outcomes, for one side. */
export interface SideMetrics {
  n: number;
  top1Accuracy: number | null;
  top3Accuracy: number | null;
  precision: number | null; // of what it proposed, how much survived confirmation
  recall: number | null; // of what the user ate, how much it surfaced
  swapRate: number | null;
  missRate: number | null;
  medianPortionErrorPct: number | null;
  meanPortionErrorPct: number | null;
}

/**
 * The paired verdict on one dimension (overall, or one breakdown bucket).
 * McNemar is the right test here BECAUSE the samples are paired: it counts
 * only the scans where the two providers DISAGREED, which is exactly where the
 * evidence about their difference lives.
 */
export interface PairedVerdict {
  bucket: string;
  n: number;
  incumbent: SideMetrics;
  challenger: SideMetrics;
  /** scans the incumbent got right and the challenger got wrong */
  incumbentOnly: number;
  /** scans the challenger got right and the incumbent got wrong */
  challengerOnly: number;
  /** McNemar z on the discordant pairs; null when there are too few to speak */
  mcNemarZ: number | null;
  /** 95% CI on the top-1 difference (challenger − incumbent), paired */
  top1Delta: number | null;
  top1DeltaCi: { low: number; high: number } | null;
  /** true only when the CI excludes zero in the challenger's favour */
  significant: boolean;
}

export interface ProviderComparisonReport {
  contractVersion: number;
  window: { from: Date; to: Date };
  incumbentId: string;
  challengerId: string;
  pairedScans: number;
  overall: PairedVerdict;
  perModality: PairedVerdict[];
  perFood: PairedVerdict[];
  perCuisine: PairedVerdict[];
  perConfidenceBand: PairedVerdict[];
  perUserSegment: PairedVerdict[];
  /** operational comparison on the SAME scans — cost and speed of the difference */
  operations: {
    incumbentMeanLatencyMs: number | null;
    challengerMeanLatencyMs: number | null;
    incumbentMeanTokens: number | null;
    challengerMeanTokens: number | null;
    challengerAvailability: number | null; // completed shadow runs / attempted
  };
  /**
   * Image-quality banding is NOT available: the platform stores no lighting or
   * sharpness signal, and inferring one from provider confidence would be
   * circular (confidence is what we are trying to judge). Reported as an
   * explicit gap rather than a fabricated dimension.
   */
  unavailableDimensions: string[];
}

// ── Drift ────────────────────────────────────────────────────────────────────

export type DriftVerdict = 'STABLE' | 'DRIFTING' | 'INSUFFICIENT_DATA';

/** Is the INCUMBENT still the provider it was? Compares its recent half against its earlier half. */
export interface DriftReport {
  contractVersion: number;
  providerId: string;
  window: { from: Date; to: Date };
  verdict: DriftVerdict;
  reasons: string[];
  quality: { recentTop1: number | null; priorTop1: number | null; delta: number | null };
  calibration: { recentEce: number | null; priorEce: number | null; delta: number | null };
  availability: { recent: number | null; prior: number | null; delta: number | null };
}

// ── Governance decision ──────────────────────────────────────────────────────

export type GovernanceAction = 'PROMOTE' | 'MAINTAIN' | 'DEMOTE' | 'HOLD' | 'REQUIRE_MORE_DATA';

/**
 * A RECOMMENDATION. The engine may never change production configuration:
 * promotion stays human-governed, and this object exists to make the human's
 * decision evidence-driven rather than intuitive.
 */
export interface GovernanceRecommendation {
  contractVersion: number;
  window: { from: Date; to: Date };
  incumbentId: string;
  challengerId: string | null;
  action: GovernanceAction;
  /** every reason is a measurable statement — never a vibe */
  reasons: string[];
  evidence: {
    pairedScans: number;
    top1Delta: number | null;
    top1DeltaCi: { low: number; high: number } | null;
    mcNemarZ: number | null;
    generalizesAcrossModalities: boolean | null;
    generalizesAcrossUsers: boolean | null;
    latencyDeltaMs: number | null;
    tokenDeltaPerScan: number | null;
    challengerAvailability: number | null;
    incumbentDrift: DriftVerdict;
  };
  /** what a human should verify before acting, in order */
  checklist: string[];
}
