import { NormalizedFood } from '../../food/adapters/food-adapter.interface';
import { Detection } from '../types/vision-contract';

/**
 * Detection label -> catalog match (Phase 2D.2 V0). Deterministic given the
 * search results: it does NOT search itself (the caller runs
 * `FoodService.search(label, limit, userId)`, reusing the platform's existing
 * normalization/typo-tolerance/favorite-boost — no parallel matching logic).
 * This module only decides which result is the primary match vs an alternate.
 */

export interface MatchResult {
  foodItemId: string | null;
  displayName: string;
  matchScore: number; // 0..1, derived from the search adapter's internal ranking
  alternates: { foodItemId: string; displayName: string; matchScore: number }[];
}

const MAX_ALTERNATES = 3;
/** The adapter's internal score can exceed 100 (favorite boost); this just normalizes for the contract. */
const SCORE_NORMALIZER = 130;

export function matchDetection(detection: Detection, searchResults: NormalizedFood[]): MatchResult {
  if (searchResults.length === 0) {
    return { foodItemId: null, displayName: detection.label, matchScore: 0, alternates: [] };
  }

  const [top, ...rest] = searchResults;
  return {
    foodItemId: top.id,
    displayName: top.name,
    matchScore: scoreFor(top),
    alternates: rest.slice(0, MAX_ALTERNATES).map((f) => ({
      foodItemId: f.id,
      displayName: f.name,
      matchScore: scoreFor(f),
    })),
  };
}

/**
 * Foods already ranked #1 by the search adapter get a full-confidence score;
 * favorites/common items retain a boost signal via a coarse position-based
 * estimate (the adapter's raw numeric score isn't exposed past NormalizedFood,
 * so this stays a deterministic, order-preserving approximation).
 */
function scoreFor(food: NormalizedFood): number {
  let score = 0.75;
  if (food.isFavorite) score += 0.15;
  if (food.isCommon) score += 0.1;
  return Math.min(1, score);
}
