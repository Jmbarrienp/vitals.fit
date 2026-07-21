import { ProviderScorecard, CalibrationReport } from '../../learning/types/eval-contract';
import { DriftReport, DriftVerdict, GOVERNANCE_CONTRACT_VERSION } from '../types/governance-contract';

/**
 * Incumbent drift detection (V4.1) — PURE. Compares a provider against ITSELF
 * across two adjacent windows: is it still the provider we promoted?
 *
 * This is a different question from "is the challenger better", and it needs
 * asking independently: a provider can silently degrade (a vendor updates a
 * model behind a stable API, a prompt version ships, traffic shifts under it)
 * without any challenger existing at all. Drift is how the platform notices
 * before its users do.
 *
 * Both scorecards and both calibration reports come from their existing owners
 * (V3.5) — this module recomputes nothing, it only differences two of their
 * outputs.
 */

/** A top-1 fall larger than this is quality drift, not sampling noise. */
export const DRIFT_TOP1_DROP = 0.05;
/** Calibration is the auto-accept gate's input; a rise this large matters. */
export const DRIFT_ECE_RISE = 0.08;
/** Availability slipping by this much is an operational signal. */
export const DRIFT_AVAILABILITY_DROP = 0.05;
/** Below this many scans per half, the halves cannot be compared honestly. */
export const DRIFT_MIN_SCANS_PER_HALF = 20;

export function detectDrift(
  providerId: string,
  recent: { scorecard: ProviderScorecard; calibration: CalibrationReport },
  prior: { scorecard: ProviderScorecard; calibration: CalibrationReport },
  window: { from: Date; to: Date },
): DriftReport {
  const reasons: string[] = [];
  const recentTop1 = recent.scorecard.top1Accuracy;
  const priorTop1 = prior.scorecard.top1Accuracy;
  const recentEce = recent.calibration.expectedCalibrationError;
  const priorEce = prior.calibration.expectedCalibrationError;
  const recentAvail = recent.scorecard.providerAvailability;
  const priorAvail = prior.scorecard.providerAvailability;

  const report = (verdict: DriftVerdict): DriftReport => ({
    contractVersion: GOVERNANCE_CONTRACT_VERSION,
    providerId,
    window,
    verdict,
    reasons,
    quality: { recentTop1, priorTop1, delta: delta(recentTop1, priorTop1) },
    calibration: { recentEce, priorEce, delta: delta(recentEce, priorEce) },
    availability: { recent: recentAvail, prior: priorAvail, delta: delta(recentAvail, priorAvail) },
  });

  if (
    recent.scorecard.sampleSizes.scans < DRIFT_MIN_SCANS_PER_HALF ||
    prior.scorecard.sampleSizes.scans < DRIFT_MIN_SCANS_PER_HALF
  ) {
    reasons.push(
      `muestra insuficiente para comparar mitades: ${prior.scorecard.sampleSizes.scans} antes / ${recent.scorecard.sampleSizes.scans} después (mínimo ${DRIFT_MIN_SCANS_PER_HALF} cada una)`,
    );
    return report('INSUFFICIENT_DATA');
  }

  const qualityDelta = delta(recentTop1, priorTop1);
  if (qualityDelta != null && qualityDelta <= -DRIFT_TOP1_DROP) {
    reasons.push(`top-1 cayó ${pct(Math.abs(qualityDelta))} (${pct(priorTop1)} → ${pct(recentTop1)})`);
  }
  const eceDelta = delta(recentEce, priorEce);
  if (eceDelta != null && eceDelta >= DRIFT_ECE_RISE) {
    reasons.push(`el error de calibración subió ${eceDelta.toFixed(4)} (${priorEce} → ${recentEce}) — la confianza reportada se volvió menos honesta`);
  }
  const availDelta = delta(recentAvail, priorAvail);
  if (availDelta != null && availDelta <= -DRIFT_AVAILABILITY_DROP) {
    reasons.push(`la disponibilidad cayó ${pct(Math.abs(availDelta))} (${pct(priorAvail)} → ${pct(recentAvail)})`);
  }

  if (reasons.length > 0) return report('DRIFTING');
  reasons.push(
    `estable: top-1 ${pct(priorTop1)} → ${pct(recentTop1)}, ECE ${priorEce ?? 'n/d'} → ${recentEce ?? 'n/d'}, disponibilidad ${pct(priorAvail)} → ${pct(recentAvail)}`,
  );
  return report('STABLE');
}

function delta(recent: number | null, prior: number | null): number | null {
  if (recent == null || prior == null) return null;
  return Math.round((recent - prior) * 10000) / 10000;
}

function pct(x: number | null): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
