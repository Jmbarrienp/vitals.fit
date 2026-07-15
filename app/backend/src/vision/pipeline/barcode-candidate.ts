import { NormalizedFood } from '../../food/adapters/food-adapter.interface';
import { BarcodeProduct } from '../types/barcode-contract';
import { ConfidenceBand, FoodCandidate } from '../types/vision-contract';
import { estimatePortion } from './portion';
import { scoreCandidate } from './confidence';

/**
 * PURE composition for the barcode modality (Phase 2D.2 V3.1) — the barcode
 * sibling of `build-candidates.ts`. Reuses `estimatePortion` and
 * `scoreCandidate` UNCHANGED (no duplicated math), but does NOT reuse
 * `matchDetection`: that module scores FUZZY label-to-catalog matches, and a
 * barcode is not fuzzy. A decoded barcode is either the SAME real-world
 * product as a given FoodItem or a different one — there is no partial match.
 *
 * Consequence: `recognition` AND `match` are both 1.0 here. `labelConfidence`
 * for a photo means "how sure are we this is chicken"; for a barcode there is
 * no such uncertainty — the digits are exact. What varies is only PORTION
 * confidence, exactly like every other modality.
 *
 * The caller (`VisionScanService.createBarcodeScan`) is responsible for
 * resolving `food` to a real `FoodItem` BEFORE calling this function — either
 * an existing exact-barcode match or a freshly upserted catalog row from a
 * successful lookup. That is why, unlike vision's `buildCandidates`,
 * `foodItemId` here is never null: a resolved barcode always identifies a
 * concrete product, confirmed or not.
 */
export function buildBarcodeCandidate(
  food: NormalizedFood,
  productHint: Pick<BarcodeProduct, 'servingGrams'> | null,
  defaultServingGrams: number | null,
): { candidate: FoodCandidate; scanConfidence: { overall: number; band: ConfidenceBand } } {
  const portion = estimatePortion(
    { label: food.name, labelConfidence: 1, portionHint: productHint?.servingGrams ? { grams: productHint.servingGrams, confidence: 0.6 } : undefined },
    defaultServingGrams,
  );
  const confidence = scoreCandidate(1, 1, portion.confidence);

  const candidate: FoodCandidate = {
    detectionIndex: 0,
    foodItemId: food.id,
    displayName: food.name,
    matchScore: 1, // exact identity, not a fuzzy rank — see module doc
    portion,
    confidence,
    alternates: [], // a barcode has no "alternate reading"; swapping means the wrong product was decoded, handled by reject + manual, not alternates
  };

  return { candidate, scanConfidence: { overall: confidence.overall, band: confidence.band } };
}
