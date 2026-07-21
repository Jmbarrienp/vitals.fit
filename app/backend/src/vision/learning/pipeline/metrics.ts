import { isProviderFailure } from '../ground-truth.reader';
import {
  EVAL_CONTRACT_VERSION,
  GroundTruthDataset,
  GroundTruthExample,
  MaybeMetric,
  MetricSlice,
  ProviderScorecard,
} from '../types/eval-contract';

/**
 * Layer 2 of the learning system (V3.5) — PURE scorecard computation. Same
 * dataset in, byte-identical scorecard out; no I/O, no clock, no randomness.
 *
 * Definitions (deterministic, documented, and the only place they live):
 *   proposal examples  P  = examples whose action ≠ ADDED_MANUAL and that
 *                           carried a proposedFoodItemId (the provider+pipeline
 *                           actually proposed an identity)
 *   identity held      A  = P where confirmedFoodItemId === proposedFoodItemId
 *   top1Accuracy           = |A| / |P|
 *   top3Accuracy           = |A ∪ alternate-hit| / |P|
 *   recognitionRecall      = |proposals confirmed| / (|proposals confirmed| + |ADDED_MANUAL|)
 *                            — of what the user actually ate, how much did the
 *                            platform surface on its own?
 *   recognitionPrecision   = Σ confirmed-from-candidates / Σ proposed candidates
 *                            (scan-level; candidates the user ignored count against it)
 *   portionErrorPct        = |proposedGrams − confirmedGrams| / confirmedGrams
 *                            over examples with both grams > 0
 *
 * A metric with no data is null (UNMEASURED) — never zero, never invented.
 * Acceptance-rate metrics for barcode/OCR/restaurant are outcome PROXIES and
 * are named as such: true per-field accuracy needs ground truth those flows
 * don't capture yet (documented gap, not hidden).
 */

const CONFIDENCE_BANDS: [string, number, number][] = [
  ['LOW', 0, 0.45],
  ['MEDIUM', 0.45, 0.75],
  ['HIGH', 0.75, 1.01],
];

export function buildScorecard(dataset: GroundTruthDataset, providerId: string): ProviderScorecard {
  const scans = dataset.scans.filter((s) => s.providerId === providerId);
  const examples = dataset.examples.filter((e) => e.providerId === providerId);

  const proposals = examples.filter((e) => e.action !== 'ADDED_MANUAL' && e.proposedFoodItemId !== null);
  const identityHeld = proposals.filter((e) => e.confirmedFoodItemId === e.proposedFoodItemId);
  const top3Held = proposals.filter(
    (e) =>
      e.confirmedFoodItemId !== null &&
      (e.confirmedFoodItemId === e.proposedFoodItemId || e.alternateFoodItemIds.includes(e.confirmedFoodItemId)),
  );
  const addedManual = examples.filter((e) => e.action === 'ADDED_MANUAL');
  const edited = proposals.filter((e) => e.action === 'EDITED_PORTION' || e.action === 'SWAPPED');

  const portionErrors = proposals
    .filter((e) => e.proposedGrams != null && e.confirmedGrams != null && e.confirmedGrams > 0)
    .map((e) => Math.abs(e.proposedGrams! - e.confirmedGrams!) / e.confirmedGrams!);

  const confirmedScans = scans.filter((s) => s.status === 'LOGGED' || s.status === 'CONFIRMED');
  const proposedCandidateTotal = scans.reduce((sum, s) => sum + (s.proposedCandidateCount ?? 0), 0);
  const confirmedFromCandidates = proposals.length;

  const latencies = scans.map((s) => s.latencyMs).filter((x): x is number => x != null);
  const tokens = scans
    .filter((s) => s.tokensIn != null || s.tokensOut != null)
    .map((s) => (s.tokensIn ?? 0) + (s.tokensOut ?? 0));

  const providerFailures = scans.filter((s) => s.status === 'FAILED' && isProviderFailure(s.failureReason));

  return {
    contractVersion: EVAL_CONTRACT_VERSION,
    providerId,
    window: dataset.window,
    sampleSizes: { scans: scans.length, examples: examples.length, confirmedScans: confirmedScans.length },

    top1Accuracy: ratio(identityHeld.length, proposals.length),
    top3Accuracy: ratio(top3Held.length, proposals.length),
    recognitionPrecision: ratio(confirmedFromCandidates, proposedCandidateTotal),
    recognitionRecall: ratio(proposals.length, proposals.length + addedManual.length),

    meanPortionErrorPct: mean(portionErrors),
    medianPortionErrorPct: median(portionErrors),

    manualCorrectionRate: ratio(edited.length, proposals.length),
    fallbackRate: rate(scans, (s) => s.status === 'FALLBACK_MANUAL'),
    rejectRate: rate(scans, (s) => s.status === 'REJECTED'),
    failureRate: rate(scans, (s) => s.status === 'FAILED'),
    providerAvailability: scans.length === 0 ? null : round4(1 - providerFailures.length / scans.length),

    barcodeAcceptanceRate: acceptance(scans.filter((s) => s.source === 'BARCODE')),
    ocrAcceptanceRate: acceptance(scans.filter((s) => s.source === 'LABEL_OCR')),
    restaurantContextAcceptanceRate: acceptance(scans.filter((s) => s.hadRestaurantContext)),

    meanLatencyMs: mean(latencies, 1),
    p50LatencyMs: median(latencies, 1),
    meanTokensPerScan: mean(tokens, 1),

    calibrationError: null, // filled by the calibration engine (Layer 3), never here

    perFood: breakdown(proposals, (e) => e.foodName ?? 'sin-nombre'),
    perUser: breakdown(proposals, (e) => e.userId),
    perCuisine: breakdown(proposals.filter((e) => e.cuisineCategory), (e) => e.cuisineCategory!),
    perConfidenceBand: breakdown(
      proposals.filter((e) => e.candidateConfidence != null),
      (e) => bandOf(e.candidateConfidence!),
    ),
    perSource: breakdown(proposals, (e) => e.source),
  };
}

function breakdown(examples: GroundTruthExample[], keyOf: (e: GroundTruthExample) => string): Record<string, MetricSlice> {
  const groups = new Map<string, GroundTruthExample[]>();
  for (const e of examples) {
    const key = keyOf(e);
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }
  const out: Record<string, MetricSlice> = {};
  // Sorted keys -> deterministic object ordering -> byte-identical scorecards.
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const held = group.filter((e) => e.confirmedFoodItemId === e.proposedFoodItemId);
    const errors = group
      .filter((e) => e.proposedGrams != null && e.confirmedGrams != null && e.confirmedGrams > 0)
      .map((e) => Math.abs(e.proposedGrams! - e.confirmedGrams!) / e.confirmedGrams!);
    out[key] = { n: group.length, top1Accuracy: ratio(held.length, group.length), medianPortionErrorPct: median(errors) };
  }
  return out;
}

function bandOf(confidence: number): string {
  for (const [name, lower, upper] of CONFIDENCE_BANDS) {
    if (confidence >= lower && confidence < upper) return name;
  }
  return 'HIGH';
}

/**
 * Acceptance among DECIDED scans. Exported since V4.0 so the rollout health
 * engine reuses this exact definition instead of growing a second one —
 * one metric, one truth. UNDONE counts as decided-and-not-accepted.
 */
export function acceptance(scans: { status: string }[]): MaybeMetric {
  const decided = scans.filter((s) => ['LOGGED', 'CONFIRMED', 'REJECTED', 'FALLBACK_MANUAL', 'UNDONE'].includes(s.status));
  const accepted = decided.filter((s) => s.status === 'LOGGED' || s.status === 'CONFIRMED');
  return ratio(accepted.length, decided.length);
}

function rate<T>(xs: T[], pred: (x: T) => boolean): MaybeMetric {
  return xs.length === 0 ? null : round4(xs.filter(pred).length / xs.length);
}

function ratio(num: number, den: number): MaybeMetric {
  return den === 0 ? null : round4(num / den);
}

export function mean(xs: number[], decimals = 4): MaybeMetric {
  if (xs.length === 0) return null;
  return roundN(xs.reduce((a, b) => a + b, 0) / xs.length, decimals);
}

export function median(xs: number[], decimals = 4): MaybeMetric {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return roundN(value, decimals);
}

function round4(x: number): number {
  return roundN(x, 4);
}

function roundN(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}
