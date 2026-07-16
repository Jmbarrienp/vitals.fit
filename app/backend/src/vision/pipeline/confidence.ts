import { CandidateConfidence, ConfidenceBand, FoodCandidate, ScanUxMode } from '../types/vision-contract';

/**
 * Deterministic confidence scoring (Phase 2D.2 V0) — three independent signals
 * combined into one band that drives the confirmation UX. Pure; no I/O.
 * Design reference: docs/nutrition-vision-architecture.md (§6).
 */

const PORTION_WEIGHT = 0.4; // portion uncertainty matters less — grams are one slider away from fixed
const HIGH_THRESHOLD = 0.75;
const MEDIUM_THRESHOLD = 0.45;

export function scoreCandidate(recognition: number, match: number, portion: number): CandidateConfidence {
  const overall = clamp01(recognition) * clamp01(match) * Math.pow(clamp01(portion), PORTION_WEIGHT);
  return { recognition: clamp01(recognition), match: clamp01(match), portion: clamp01(portion), overall, band: bandFor(overall) };
}

export function bandFor(overall: number): ConfidenceBand {
  if (overall >= HIGH_THRESHOLD) return 'HIGH';
  if (overall >= MEDIUM_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}

/**
 * The confirmation UX policy (V1), owned server-side so mobile stays presentational.
 * A degraded scan (no detections / provider failure) or LOW confidence steers to
 * manual logging; MEDIUM shows the proposal with uncertainty; HIGH is a confident
 * confirm. Friction can only go down — FALLBACK never blocks, it prefills.
 *
 * V3.6 — `autoAccepted` is the ONE new input: when the trust engine actually
 * executed an auto-accept, the mode says so. Additive and optional, so every
 * pre-V3.6 caller keeps its exact behavior. Note the ORDER: degradation and a
 * LOW band still win first, so no amount of earned trust can auto-accept a scan
 * the platform itself isn't confident in. Trust plugs into the seam V1 built
 * rather than growing a second, parallel decision path.
 */
export function deriveUxMode(
  band: ConfidenceBand,
  fallbackReason: string | null,
  candidateCount: number,
  autoAccepted = false,
): ScanUxMode {
  if (fallbackReason !== null || candidateCount === 0 || band === 'LOW') return 'FALLBACK';
  if (autoAccepted) return 'AUTO_ACCEPT';
  if (band === 'MEDIUM') return 'REVIEW';
  return 'CONFIRM';
}

/** Scan-level confidence: calorie-weighted mean of candidate overalls (falls back to a plain mean). */
export function scoreScan(candidates: FoodCandidate[], calorieWeights: number[]): { overall: number; band: ConfidenceBand } {
  if (candidates.length === 0) return { overall: 0, band: 'LOW' };
  const totalWeight = calorieWeights.reduce((a, b) => a + b, 0);
  const overall =
    totalWeight > 0
      ? candidates.reduce((sum, c, i) => sum + c.confidence.overall * calorieWeights[i], 0) / totalWeight
      : candidates.reduce((sum, c) => sum + c.confidence.overall, 0) / candidates.length;
  return { overall, band: bandFor(overall) };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
