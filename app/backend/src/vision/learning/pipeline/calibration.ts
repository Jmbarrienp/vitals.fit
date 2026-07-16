import {
  CalibrationBin,
  CalibrationCurve,
  CalibrationReport,
  EVAL_CONTRACT_VERSION,
  GroundTruthDataset,
} from '../types/eval-contract';

/**
 * Layer 3 of the learning system (V3.5) — PURE confidence calibration.
 *
 * A provider that says "0.9" should be right ~90% of the time. This module
 * measures whether it is: reported candidate confidence is binned, each bin's
 * EMPIRICAL accuracy (identity held under user confirmation — the only
 * supervisor) is computed, and the gap is the Expected Calibration Error.
 *
 * The curve is DERIVED, never materialized (the V3.3 priors decision, applied
 * again): same ground truth -> same curve, nothing to keep in sync, and every
 * future provider reuses this exact interface — build its curve from its own
 * traffic, then `calibrate()` maps its reported confidence to what that
 * confidence has historically MEANT. Binned mapping, deliberately simple;
 * isotonic regression can replace the internals later without changing the
 * interface (that is why the curve, not the algorithm, is the contract).
 */

export const CALIBRATION_BIN_COUNT = 10;
/** Below this many examples a bin says nothing — calibrate() falls through to raw confidence. */
export const MIN_BIN_SAMPLES = 5;

export function buildCalibrationReport(dataset: GroundTruthDataset, providerId: string): CalibrationReport {
  const examples = dataset.examples.filter(
    (e) =>
      e.providerId === providerId &&
      e.action !== 'ADDED_MANUAL' &&
      e.proposedFoodItemId !== null &&
      e.candidateConfidence != null,
  );

  const bins: CalibrationBin[] = [];
  for (let i = 0; i < CALIBRATION_BIN_COUNT; i++) {
    const lower = i / CALIBRATION_BIN_COUNT;
    const upper = (i + 1) / CALIBRATION_BIN_COUNT;
    const members = examples.filter((e) => {
      const c = e.candidateConfidence!;
      return i === CALIBRATION_BIN_COUNT - 1 ? c >= lower && c <= 1 : c >= lower && c < upper;
    });
    const held = members.filter((e) => e.confirmedFoodItemId === e.proposedFoodItemId);
    bins.push({
      lower,
      upper,
      n: members.length,
      meanReportedConfidence:
        members.length === 0 ? null : round4(members.reduce((s, e) => s + e.candidateConfidence!, 0) / members.length),
      empiricalAccuracy: members.length === 0 ? null : round4(held.length / members.length),
    });
  }

  const total = examples.length;
  let ece: number | null = null;
  let signedGap = 0;
  if (total > 0) {
    ece = 0;
    for (const bin of bins) {
      if (bin.n === 0 || bin.meanReportedConfidence == null || bin.empiricalAccuracy == null) continue;
      ece += (bin.n / total) * Math.abs(bin.empiricalAccuracy - bin.meanReportedConfidence);
      signedGap += (bin.n / total) * (bin.meanReportedConfidence - bin.empiricalAccuracy);
    }
    ece = round4(ece);
  }

  return {
    curve: {
      contractVersion: EVAL_CONTRACT_VERSION,
      providerId,
      builtFrom: { examples: total, window: dataset.window },
      bins,
    },
    expectedCalibrationError: ece,
    overconfident: total === 0 ? null : signedGap > 0,
  };
}

/**
 * Map a reported confidence to what that confidence has historically meant for
 * this provider. Sparse or empty bins fall through to the raw value — the
 * calibrator must never be more opinionated than its evidence.
 */
export function calibrate(confidence: number, curve: CalibrationCurve): number {
  const clamped = Math.max(0, Math.min(1, confidence));
  const index = Math.min(CALIBRATION_BIN_COUNT - 1, Math.floor(clamped * CALIBRATION_BIN_COUNT));
  const bin = curve.bins[index];
  if (!bin || bin.n < MIN_BIN_SAMPLES || bin.empiricalAccuracy == null) return clamped;
  return bin.empiricalAccuracy;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
