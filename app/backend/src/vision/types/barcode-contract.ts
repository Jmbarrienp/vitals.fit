/**
 * Barcode lookup contract (Phase 2D.2 V3.1). A SIBLING to `vision-contract.ts`,
 * not an extension of it — barcode decoding happens on-device (camera hardware
 * via `expo-camera`), so the backend never receives an image. What it receives
 * is an already-decoded barcode string, and what it needs to do is LOOKUP, not
 * RECOGNIZE. That is a different port with a different shape:
 *
 *   VisionProvider.recognize({imageRef})   -> RecognitionResult (labels, uncertain)
 *   BarcodeLookupProvider.lookup(barcode)  -> BarcodeLookupResult (exact digits, product may not exist)
 *
 * No @prisma/client imports — same anti-corruption-layer rule as the vision
 * contract. Product macros here are PER 100g, matching FoodItem's own shape, so
 * the pipeline stage that turns this into a catalog row never has to convert.
 */

export const BARCODE_CONTRACT_VERSION = 1;

export interface BarcodeProduct {
  name: string;
  brand: string | null;
  /** A serving hint in grams if the source publishes one (e.g. "1 porción = 30g"). Never invented by the platform. */
  servingGrams: number | null;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
}

/** What a BarcodeLookupProvider returns. `found: false` is a normal, valid outcome — not an error. */
export interface BarcodeLookupResult {
  providerId: string;
  providerVersion: string;
  found: boolean;
  product: BarcodeProduct | null; // present iff found
  latencyMs: number;
  raw?: unknown; // audit only; never consumed downstream, never a vendor payload leak
}
