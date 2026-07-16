import { EVAL_CONTRACT_VERSION, PromotionDecision, ProviderScorecard } from '../types/eval-contract';

/**
 * Layer 4 of the learning system (V3.5) — PURE, data-driven promotion policy.
 *
 * A provider becomes default because its scorecard STATISTICALLY beats the
 * incumbent's, never because it "feels better". The policy is deliberately
 * conservative and asymmetric: ties keep the incumbent, insufficient data
 * keeps the incumbent, and a challenger that wins on accuracy but regresses
 * on portion error or failure rate still loses. Switching providers has real
 * cost (user trust, prompt retuning, new calibration curve) — the burden of
 * proof is entirely on the challenger.
 *
 * The decision REPORTS; a human flips VISION_PROVIDER. Promotion is offline
 * by design: production always runs exactly ONE provider, no ensembles, no
 * voting, no runtime comparisons.
 */

/** Below these the comparison is an anecdote, not evidence. */
export const MIN_SCANS_PER_PROVIDER = 50;
export const MIN_EXAMPLES_PER_PROVIDER = 100;
/** One-sided z at 95% confidence — the challenger must be BETTER, not just different. */
export const PROMOTION_Z_THRESHOLD = 1.645;
/** A challenger may not regress failure rate by more than 2 points, whatever its accuracy. */
export const MAX_FAILURE_REGRESSION = 0.02;

export function decidePromotion(incumbent: ProviderScorecard, challenger: ProviderScorecard): PromotionDecision {
  const reasons: string[] = [];
  const decision = (verdict: PromotionDecision['verdict'], z: number | null): PromotionDecision => ({
    contractVersion: EVAL_CONTRACT_VERSION,
    incumbentId: incumbent.providerId,
    challengerId: challenger.providerId,
    verdict,
    reasons,
    zScoreTop1: z,
  });

  // Gate 0 — enough evidence on BOTH sides.
  for (const [card, label] of [
    [incumbent, 'incumbent'],
    [challenger, 'challenger'],
  ] as const) {
    if (card.sampleSizes.scans < MIN_SCANS_PER_PROVIDER || card.sampleSizes.examples < MIN_EXAMPLES_PER_PROVIDER) {
      reasons.push(
        `${label} '${card.providerId}' has insufficient data: ${card.sampleSizes.scans} scans / ${card.sampleSizes.examples} examples (minimum ${MIN_SCANS_PER_PROVIDER}/${MIN_EXAMPLES_PER_PROVIDER})`,
      );
    }
  }
  if (reasons.length > 0) return decision('INSUFFICIENT_DATA', null);

  if (incumbent.top1Accuracy == null || challenger.top1Accuracy == null) {
    reasons.push('top-1 accuracy unmeasured for at least one provider');
    return decision('INSUFFICIENT_DATA', null);
  }

  // Gate 1 — statistical superiority on top-1 accuracy (two-proportion, one-sided).
  const z = twoProportionZ(
    challenger.top1Accuracy,
    challenger.sampleSizes.examples,
    incumbent.top1Accuracy,
    incumbent.sampleSizes.examples,
  );
  if (z < PROMOTION_Z_THRESHOLD) {
    reasons.push(
      `challenger top-1 ${fmt(challenger.top1Accuracy)} does not statistically beat incumbent ${fmt(incumbent.top1Accuracy)} (z=${z.toFixed(2)} < ${PROMOTION_Z_THRESHOLD})`,
    );
    return decision('KEEP_INCUMBENT', round2(z));
  }
  reasons.push(
    `challenger top-1 ${fmt(challenger.top1Accuracy)} statistically beats incumbent ${fmt(incumbent.top1Accuracy)} (z=${z.toFixed(2)})`,
  );

  // Gate 2 — no regression on portion error (when both measured).
  if (
    challenger.medianPortionErrorPct != null &&
    incumbent.medianPortionErrorPct != null &&
    challenger.medianPortionErrorPct > incumbent.medianPortionErrorPct
  ) {
    reasons.push(
      `challenger regresses median portion error (${fmt(challenger.medianPortionErrorPct)} > ${fmt(incumbent.medianPortionErrorPct)})`,
    );
    return decision('KEEP_INCUMBENT', round2(z));
  }

  // Gate 3 — no meaningful regression on failure rate.
  const incumbentFailure = incumbent.failureRate ?? 0;
  const challengerFailure = challenger.failureRate ?? 0;
  if (challengerFailure > incumbentFailure + MAX_FAILURE_REGRESSION) {
    reasons.push(`challenger regresses failure rate (${fmt(challengerFailure)} > ${fmt(incumbentFailure)} + ${MAX_FAILURE_REGRESSION})`);
    return decision('KEEP_INCUMBENT', round2(z));
  }

  reasons.push('no regression on portion error or failure rate — promotion criteria met');
  return decision('PROMOTE_CHALLENGER', round2(z));
}

/** Standard two-proportion z-statistic with pooled variance. Deterministic; no RNG anywhere. */
export function twoProportionZ(p1: number, n1: number, p2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const pooled = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

function fmt(x: number): string {
  return (x * 100).toFixed(1) + '%';
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
