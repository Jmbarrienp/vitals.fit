import { NormalizedFood } from '../../food/adapters/food-adapter.interface';
import { Detection, FoodCandidate } from '../types/vision-contract';
import { matchDetection } from './matching';
import { estimatePortion } from './portion';
import { PortionPriorInputs, resolvePortion } from './portion-engine';
import { scoreCandidate, scoreScan } from './confidence';

/**
 * PURE composition of the matching + portion + confidence stages (Phase 2D.2
 * V0). Takes detections plus their ALREADY-FETCHED search results (the only I/O
 * — FoodService.search — happens in the orchestrating service, not here), and
 * returns the FoodCandidates + scan-level confidence shown to the user.
 *
 * V3.3: `priorInputsByIndex` carries the already-fetched portion priors (user
 * history, planner expectation, correction bias). Additive and optional — when
 * absent the base `estimatePortion` result passes through unchanged, so every
 * pre-V3.3 caller and every user without history sees identical behavior.
 */
export function buildCandidates(
  detections: Detection[],
  searchResultsByIndex: NormalizedFood[][],
  defaultServingGramsByIndex: (number | null)[] = [],
  priorInputsByIndex: (PortionPriorInputs | null)[] = [],
): {
  candidates: FoodCandidate[];
  scanConfidence: { overall: number; band: import('../types/vision-contract').ConfidenceBand };
} {
  const candidates: FoodCandidate[] = detections.map((detection, i) => {
    const match = matchDetection(detection, searchResultsByIndex[i] ?? []);
    const base = estimatePortion(detection, defaultServingGramsByIndex[i] ?? null);
    const { portion, explanation } = resolvePortion(base, priorInputsByIndex[i] ?? null);
    const confidence = scoreCandidate(detection.labelConfidence, match.matchScore, portion.confidence);
    return {
      detectionIndex: i,
      foodItemId: match.foodItemId,
      displayName: match.displayName,
      matchScore: match.matchScore,
      portion,
      confidence,
      alternates: match.alternates,
      portionExplanation: explanation,
    };
  });

  const calorieWeights = candidates.map((c) => c.portion.grams); // grams as a cheap energy proxy pre-macro-resolution
  const scanConfidence = scoreScan(candidates, calorieWeights);

  return { candidates, scanConfidence };
}

/** Same hour-of-day buckets LogsService infers with, kept independent so vision never imports it. */
export function inferMealType(date: Date): string {
  const h = date.getHours();
  if (h < 11) return 'BREAKFAST';
  if (h < 16) return 'LUNCH';
  if (h < 21) return 'DINNER';
  return 'SNACK';
}
