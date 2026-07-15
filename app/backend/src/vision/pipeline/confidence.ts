import { CandidateConfidence, ConfidenceBand, FoodCandidate } from '../types/vision-contract';

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
