import { NutritionLabel } from '../types/ocr-contract';
import { ConfidenceBand, FoodCandidate } from '../types/vision-contract';
import { labelCompleteness } from './label-parser';
import { scoreCandidate } from './confidence';

/**
 * PURE composition for the OCR modality (Phase 2D.2 V3.2) — the label sibling of
 * `build-candidates.ts` and `barcode-candidate.ts`. Reuses `scoreCandidate`
 * unchanged (and therefore `bandFor`'s thresholds, which stay defined in exactly
 * one place across all three modalities).
 *
 * What each confidence signal means for a label — the semantics differ per
 * modality and are documented at each site rather than assumed:
 *
 *  - recognition = transcription confidence × completeness. Both answer the same
 *    question ("did we read this label correctly"), so they compose here.
 *    Plausibility (Atwater) folds in too: numbers that contradict each other are
 *    evidence of a misread digit.
 *  - match = 1. A label identifies its own product; there is no catalog lookup to
 *    be uncertain about — same reasoning as barcode, opposite reasoning to photo.
 *  - portion = how sure we are of the serving. This is the one axis a label can
 *    genuinely be vague about ("1 bar", volumetric-only servings).
 *
 * `foodItemId` is deliberately ALWAYS null. The label is the ground truth for the
 * package in the user's hand, so the candidate is a one-off item carrying the
 * label's own macros through `LogsService`'s existing customName path. Linking it
 * to a catalog FoodItem instead would make `resolveItem` recompute macros from
 * that item's per-100g values and silently discard the printed numbers. Catalog
 * matches are offered as `alternates` — a deliberate user swap, never a default.
 */

/** A serving we could not convert to mass still has to log something; the portion method records that it was a default. */
const UNKNOWN_SERVING_GRAMS = 100;

export function buildLabelCandidate(
  label: NutritionLabel,
  plausibility: number,
  alternates: FoodCandidate['alternates'] = [],
): { candidate: FoodCandidate; scanConfidence: { overall: number; band: ConfidenceBand } } {
  const completeness = labelCompleteness(label);
  const recognition = clamp01(label.confidence) * completeness * clamp01(plausibility);

  const servingKnown = label.servingUnit !== 'unit' && label.servingSize > 0;
  const portion: FoodCandidate['portion'] = servingKnown
    ? { grams: label.servingSize, method: 'PROVIDER_ESTIMATE', confidence: 0.9 }
    : { grams: UNKNOWN_SERVING_GRAMS, method: 'SERVING_DEFAULT', confidence: 0.2 };

  const confidence = scoreCandidate(recognition, 1, portion.confidence);

  const candidate: FoodCandidate = {
    detectionIndex: 0,
    foodItemId: null, // one-off by design — see module doc
    displayName: label.productName ?? 'Producto empacado',
    matchScore: 0, // no catalog match is attempted for the primary candidate
    portion,
    confidence,
    alternates,
  };

  return { candidate, scanConfidence: { overall: confidence.overall, band: confidence.band } };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
