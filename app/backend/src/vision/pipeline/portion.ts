import { Detection, PortionEstimate } from '../types/vision-contract';

/**
 * Portion estimation (Phase 2D.2 V0) — a strategy chain, first applicable wins,
 * method always recorded. PURE: takes whatever signals already exist (the
 * detection's own hint, an optional default serving size) and never queries
 * anything itself. Future strategies (REFERENCE_OBJECT, PLATE_RATIO) plug into
 * this same chain without touching callers.
 */

const FALLBACK_GRAMS = 100;
const MIN_GRAMS = 10;
const MAX_GRAMS = 600;

export function estimatePortion(detection: Detection, defaultServingGrams: number | null): PortionEstimate {
  if (detection.portionHint?.grams != null && detection.portionHint.grams > 0) {
    return {
      grams: clamp(detection.portionHint.grams),
      method: 'PROVIDER_ESTIMATE',
      confidence: detection.portionHint.confidence ?? 0.5,
    };
  }

  if (defaultServingGrams != null && defaultServingGrams > 0) {
    return { grams: clamp(defaultServingGrams), method: 'SERVING_DEFAULT', confidence: 0.35 };
  }

  return { grams: FALLBACK_GRAMS, method: 'SERVING_DEFAULT', confidence: 0.2 };
}

function clamp(grams: number): number {
  return Math.max(MIN_GRAMS, Math.min(MAX_GRAMS, Math.round(grams)));
}
