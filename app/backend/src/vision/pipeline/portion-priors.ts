/**
 * Portion priors (Nutrition Vision V3.3) — the DERIVED statistics the portion
 * engine blends with the provider's estimate. PURE: every function here maps
 * observations (already fetched by the orchestrating service) to numbers, with
 * no I/O, no randomness and no hidden state. Same history in -> same prior out.
 *
 * Deliberately NOT a materialized table: the observation corpus already lives
 * in `LoggedMealItem.amountG` (validated platform output — what the user
 * actually confirmed or typed, never a raw provider number). Deriving the prior
 * at read time means there is nothing to keep in sync, and "learning" is simply
 * the next query seeing one more row. This mirrors how UserNutritionState
 * derives rather than accumulates.
 */

/** Below this many observations there is no meaningful notion of "typical". */
export const HISTORY_MIN_N = 2;
/** A meal-type-specific subset needs a bit more evidence before it outranks the all-meals prior. */
export const MEALTYPE_MIN_N = 3;
/**
 * Shrinkage constant for the history weight w = n/(n+K): at n=3 the user's own
 * history already counts as much as everything else combined; by n=12 it
 * dominates (~0.8). This is the "progressively trust the user more than the
 * model" dial, and it is deliberately a constant — not tunable per user — so
 * the blend stays explainable.
 */
export const HISTORY_HALF_TRUST_N = 3;
/** Weight cap: beyond 12 observations more rows sharpen the median but not the trust. */
export const HISTORY_N_CAP = 12;
/** Correction ratios below this count say more about noise than about the model. */
export const BIAS_MIN_N = 5;
/** A learned bias outside this range means something is broken, not that the model is 2× off. */
export const BIAS_MIN = 0.5;
export const BIAS_MAX = 2.0;

export interface PortionPrior {
  /** grams — the user's typical confirmed portion for this food */
  median: number;
  /** median absolute deviation, grams — how consistent the user is */
  mad: number;
  /** observations behind the estimate */
  n: number;
  /** whether the prior came from same-meal-type logs or all logs of this food */
  scope: 'MEAL_TYPE' | 'ALL_MEALS';
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median absolute deviation — robust spread; one absurd log can't inflate it the way it would a stddev. */
export function mad(xs: number[], med: number): number {
  return median(xs.map((x) => Math.abs(x - med)));
}

/**
 * Chooses which observation set backs the prior: the meal-type subset when it
 * has enough evidence (the same user may eat 200g of rice at lunch and 80g at
 * dinner), otherwise all logs of the food, otherwise no prior at all.
 */
export function selectPrior(allGrams: number[], mealTypeGrams: number[]): PortionPrior | null {
  const pick = (xs: number[], scope: PortionPrior['scope']): PortionPrior => {
    const med = median(xs);
    return { median: med, mad: mad(xs, med), n: xs.length, scope };
  };
  if (mealTypeGrams.length >= MEALTYPE_MIN_N) return pick(mealTypeGrams, 'MEAL_TYPE');
  if (allGrams.length >= HISTORY_MIN_N) return pick(allGrams, 'ALL_MEALS');
  return null;
}

/** w = min(n, cap) / (min(n, cap) + K) — grows with evidence, capped, never reaches 1. */
export function historyWeight(n: number): number {
  const capped = Math.min(n, HISTORY_N_CAP);
  return capped / (capped + HISTORY_HALF_TRUST_N);
}

/**
 * The correction engine's output: a single multiplicative bias learned from how
 * this user has historically corrected PROVIDER_ESTIMATE portions
 * (confirmedGrams / proposedGrams per confirmation). ACCEPTED rows contribute
 * ratio 1.0, which naturally regularizes the median toward "no correction" —
 * a user who mostly accepts keeps the model honest. Median (not mean) so one
 * wild edit can't swing it; clamped because a bias outside [0.5, 2] indicates
 * a data problem, not a real systematic error. Returns null (no correction)
 * until there is enough supervision.
 */
export function computeBias(ratios: number[]): number | null {
  const usable = ratios.filter((r) => Number.isFinite(r) && r > 0);
  if (usable.length < BIAS_MIN_N) return null;
  const raw = median(usable);
  const clamped = Math.max(BIAS_MIN, Math.min(BIAS_MAX, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * Prior strength -> portion confidence. n>=8 with a tight spread means the
 * platform genuinely knows this user's portion; a two-log prior is a hint.
 * These map into the SAME 0..1 portion slot `scoreCandidate` already consumes.
 */
export function priorConfidence(prior: PortionPrior): number {
  if (prior.n >= 8 && prior.mad <= 0.2 * prior.median) return 0.85;
  if (prior.n >= 4) return 0.7;
  return 0.55;
}
