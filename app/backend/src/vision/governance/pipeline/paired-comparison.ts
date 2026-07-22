import {
  GOVERNANCE_CONTRACT_VERSION,
  PairedOutcome,
  PairedVerdict,
  ProviderComparisonReport,
  SideMetrics,
  SideOutcome,
} from '../types/governance-contract';

/**
 * Paired provider comparison (V4.1) — PURE. Given outcomes where BOTH providers
 * were judged on the SAME scan against the SAME user confirmation, decide
 * whether the challenger is genuinely better and where.
 *
 * Why McNemar rather than the two-proportion z the promotion policy uses: the
 * samples here are PAIRED. Every scan was seen by both providers, so the scans
 * they both got right (or both got wrong) carry no information about their
 * DIFFERENCE — they only dilute it. McNemar looks exactly at the discordant
 * pairs, which is where the evidence lives. Using an unpaired test on paired
 * data would understate a real difference and waste the whole point of shadow
 * evaluation.
 *
 * The two tests coexist without duplicating each other: V3.5's z-test judges
 * unpaired production traffic (all it ever has), this judges paired shadow
 * evidence. Different data, different question, different tool — and the
 * promotion decision states which one it used.
 */

/** Below this many discordant pairs a difference is a coin flip, not a finding. */
export const MIN_DISCORDANT_PAIRS = 10;
/** Buckets thinner than this are noise; reported but never significant. */
export const MIN_BUCKET_N = 5;
/** 95% two-sided normal quantile — the CI the promotion decision consumes. */
const Z_95 = 1.96;
const MAX_BUCKETS = 25;

export function buildComparisonReport(
  outcomes: PairedOutcome[],
  incumbentId: string,
  challengerId: string,
  operations: ProviderComparisonReport['operations'],
  window: { from: Date; to: Date },
): ProviderComparisonReport {
  return {
    contractVersion: GOVERNANCE_CONTRACT_VERSION,
    window,
    incumbentId,
    challengerId,
    pairedScans: outcomes.length,
    overall: verdict('overall', outcomes),
    perModality: bucketed(outcomes, (o) => o.source),
    perFood: bucketed(outcomes, (o) => o.foodName ?? 'sin-nombre'),
    perCuisine: bucketed(
      outcomes.filter((o) => o.cuisine),
      (o) => o.cuisine!,
    ),
    perConfidenceBand: bucketed(outcomes, (o) => o.confidenceBand),
    perUserSegment: bucketed(outcomes, (o) => o.userId),
    operations,
    // Honest gap rather than a fabricated dimension — see the contract's note.
    unavailableDimensions: ['IMAGE_QUALITY_BAND: la plataforma no almacena señal de iluminación/nitidez'],
  };
}

function bucketed(outcomes: PairedOutcome[], keyOf: (o: PairedOutcome) => string): PairedVerdict[] {
  const groups = new Map<string, PairedOutcome[]>();
  for (const o of outcomes) {
    const key = keyOf(o);
    const group = groups.get(key);
    if (group) group.push(o);
    else groups.set(key, [o]);
  }
  // Sorted keys -> deterministic ordering -> byte-identical reports.
  return [...groups.keys()]
    .sort()
    .map((key) => verdict(key, groups.get(key)!))
    .slice(0, MAX_BUCKETS);
}

export function verdict(bucket: string, outcomes: PairedOutcome[]): PairedVerdict {
  const n = outcomes.length;
  const incumbentOnly = outcomes.filter((o) => o.incumbent.top1Hit && !o.challenger.top1Hit).length;
  const challengerOnly = outcomes.filter((o) => !o.incumbent.top1Hit && o.challenger.top1Hit).length;
  const discordant = incumbentOnly + challengerOnly;

  // McNemar on the discordant pairs only. Positive z favours the challenger.
  const mcNemarZ =
    discordant >= MIN_DISCORDANT_PAIRS ? round4((challengerOnly - incumbentOnly) / Math.sqrt(discordant)) : null;

  const incumbent = sideMetrics(outcomes.map((o) => o.incumbent));
  const challenger = sideMetrics(outcomes.map((o) => o.challenger));

  let top1Delta: number | null = null;
  let top1DeltaCi: { low: number; high: number } | null = null;
  if (n >= MIN_BUCKET_N && incumbent.top1Accuracy != null && challenger.top1Accuracy != null) {
    top1Delta = round4(challenger.top1Accuracy - incumbent.top1Accuracy);
    // Paired proportion difference: variance comes from the discordant cells.
    const se = Math.sqrt(Math.max(discordant, 1)) / n;
    top1DeltaCi = { low: round4(top1Delta - Z_95 * se), high: round4(top1Delta + Z_95 * se) };
  }

  // Significant only when the interval sits entirely on the challenger's side
  // AND there were enough disagreements to have measured anything at all.
  const significant = top1DeltaCi != null && top1DeltaCi.low > 0 && mcNemarZ != null && mcNemarZ > 0;

  return {
    bucket,
    n,
    incumbent,
    challenger,
    incumbentOnly,
    challengerOnly,
    mcNemarZ,
    top1Delta,
    top1DeltaCi,
    significant,
  };
}

export function sideMetrics(sides: SideOutcome[]): SideMetrics {
  const n = sides.length;
  if (n === 0) {
    return {
      n: 0,
      top1Accuracy: null,
      top3Accuracy: null,
      precision: null,
      recall: null,
      swapRate: null,
      missRate: null,
      medianPortionErrorPct: null,
      meanPortionErrorPct: null,
    };
  }
  const proposed = sides.filter((s) => !s.missed); // it put something forward
  const errors = sides.map((s) => s.portionErrorPct).filter((x): x is number => x != null);

  return {
    n,
    top1Accuracy: ratio(sides.filter((s) => s.top1Hit).length, n),
    top3Accuracy: ratio(sides.filter((s) => s.top3Hit).length, n),
    // Of what it proposed, how much survived the user's confirmation.
    precision: ratio(proposed.filter((s) => s.top1Hit).length, proposed.length),
    // Of what the user actually ate, how much it surfaced at all.
    recall: ratio(sides.filter((s) => s.top3Hit).length, n),
    swapRate: ratio(sides.filter((s) => s.swapped).length, n),
    missRate: ratio(sides.filter((s) => s.missed).length, n),
    medianPortionErrorPct: median(errors),
    meanPortionErrorPct: errors.length === 0 ? null : round4(errors.reduce((a, b) => a + b, 0) / errors.length),
  };
}

/** Does the challenger's advantage hold up across buckets, or is it one lucky slice? */
export function generalizes(verdicts: PairedVerdict[]): boolean | null {
  const usable = verdicts.filter((v) => v.n >= MIN_BUCKET_N && v.top1Delta != null);
  if (usable.length < 2) return null; // one bucket cannot generalize by definition
  const nonRegressing = usable.filter((v) => (v.top1Delta ?? 0) >= 0).length;
  return nonRegressing / usable.length >= 0.75;
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : round4(num / den);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round4(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
