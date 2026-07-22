import { GroundTruthDataset, CalibrationReport } from '../../learning/types/eval-contract';
import { acceptance, mean, median } from '../../learning/pipeline/metrics';
import { isProviderFailure } from '../../learning/ground-truth.reader';
import { TrustDecisionRow } from '../rollout-data.reader';
import { HealthReport, ROLLOUT_CONTRACT_VERSION } from '../types/rollout-contract';

/**
 * Rollout health (V4.0) — PURE. Every number is derived from append-only data
 * through the metric owners that already exist:
 *   acceptance()        reused verbatim from the Learning metrics module
 *   isProviderFailure() reused from the ground-truth reader
 *   calibration ECE     computed by the Calibration owner; drift is just the
 *                       difference between two of its reports
 *   promotion status    quoted VERBATIM from the Promotion owner — never
 *                       recomputed here
 * Nothing is stored twice; a health report is recomputable from scratch for
 * any historical window, forever.
 *
 * False positive  = the platform auto-accepted and the user undid it.
 * False negative  = the platform demanded review and the user then accepted
 *                   every item unchanged — friction without cause. (Only
 *                   measurable on scans the user went on to confirm.)
 */

export function buildHealthReport(
  dataset: GroundTruthDataset,
  decisions: TrustDecisionRow[],
  undoneScanIds: Set<string>,
  calibrationNow: CalibrationReport,
  calibrationPrevious: CalibrationReport,
  promotion: { status: string; detail: string },
  window: { from: Date; to: Date },
): HealthReport {
  const scans = dataset.scans;
  const executed = decisions.filter((d) => d.executed);
  const falsePositives = executed.filter((d) => undoneScanIds.has(d.scanId)).length;

  // FN: REVIEW_REQUIRED decisions whose scan's confirmed items were ALL clean accepts.
  const examplesByScan = new Map<string, typeof dataset.examples>();
  for (const e of dataset.examples) {
    const group = examplesByScan.get(e.scanId);
    if (group) group.push(e);
    else examplesByScan.set(e.scanId, [e]);
  }
  const falseNegatives = decisions.filter((d) => {
    if (d.action !== 'REVIEW_REQUIRED') return false;
    const examples = examplesByScan.get(d.scanId);
    if (!examples || examples.length === 0) return false; // never confirmed — unknowable, not counted
    return examples.every((e) => e.action === 'ACCEPTED');
  }).length;

  const eceNow = calibrationNow.expectedCalibrationError;
  const ecePrev = calibrationPrevious.expectedCalibrationError;

  return {
    contractVersion: ROLLOUT_CONTRACT_VERSION,
    window,
    scans: scans.length,
    acceptanceRate: acceptance(scans),
    undoRate:
      executed.length === 0
        ? null
        : round4(executed.filter((d) => undoneScanIds.has(d.scanId)).length / executed.length),
    manualFallbackRate: rate(scans, (s) => s.status === 'FALLBACK_MANUAL'),
    providerFailureRate: rate(scans, (s) => s.status === 'FAILED' && isProviderFailure(s.failureReason)),
    meanLatencyMs: mean(
      scans.map((s) => s.latencyMs).filter((x): x is number => x != null),
      1,
    ),
    p50LatencyMs: median(
      scans.map((s) => s.latencyMs).filter((x): x is number => x != null),
      1,
    ),
    meanScanConfidence: mean(scans.map((s) => s.scanConfidence).filter((x): x is number => x != null)),
    calibration: {
      currentEce: eceNow,
      previousEce: ecePrev,
      drift: eceNow == null || ecePrev == null ? null : round4(Math.abs(eceNow - ecePrev)),
    },
    promotion,
    falsePositives,
    falseNegatives,
  };
}

/**
 * The single "is health green?" definition — gates and stage derivation both
 * consume THIS, so there are never two competing notions of green.
 */
export const HEALTH_MAX_UNDO_RATE = 0.2;
export const HEALTH_MAX_PROVIDER_FAILURE_RATE = 0.15;
export const HEALTH_MAX_ECE = 0.3;

export function isHealthGreen(health: HealthReport): { green: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (health.undoRate != null && health.undoRate > HEALTH_MAX_UNDO_RATE) {
    reasons.push(`tasa de undo ${fmt(health.undoRate)} > ${fmt(HEALTH_MAX_UNDO_RATE)}`);
  }
  if (health.providerFailureRate != null && health.providerFailureRate > HEALTH_MAX_PROVIDER_FAILURE_RATE) {
    reasons.push(`fallos de proveedor ${fmt(health.providerFailureRate)} > ${fmt(HEALTH_MAX_PROVIDER_FAILURE_RATE)}`);
  }
  if (health.calibration.currentEce != null && health.calibration.currentEce > HEALTH_MAX_ECE) {
    reasons.push(`ECE ${health.calibration.currentEce} > ${HEALTH_MAX_ECE}`);
  }
  return { green: reasons.length === 0, reasons };
}

function rate<T>(xs: T[], pred: (x: T) => boolean): number | null {
  return xs.length === 0 ? null : round4(xs.filter(pred).length / xs.length);
}

function fmt(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
