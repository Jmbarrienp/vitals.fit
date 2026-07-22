/**
 * Nutrition label OCR contract (Phase 2D.2 V3.2). A SIBLING to
 * `vision-contract.ts` and `barcode-contract.ts` — a third perception modality
 * with a third input/output shape:
 *
 *   VisionProvider.recognize({imageRef})   -> RecognitionResult   (labels; identity, inferred)
 *   BarcodeLookupProvider.lookup(barcode)  -> BarcodeLookupResult (product;  identity, exact)
 *   OCRProvider.extract({imageRef})        -> LabelExtraction     (text;     FACTS, transcribed)
 *
 * ── Why this contract carries nutrition when RecognitionResult must never ──
 *
 * The platform's standing rule (strategy §6.3) is that `RecognitionResult`
 * transports perception, never nutrition: a model asked "how many calories is
 * this plate?" INVENTS a number from appearance, and an invented calorie count
 * must never reach the user. That rule is intact and unmodified — `Detection`
 * still has no macro field, and `parseDetections` still has nowhere to put one.
 *
 * OCR is epistemically different: the macros are PRINTED ON THE LABEL by the
 * manufacturer. The provider transcribes them; it does not infer them. The
 * ground truth is inside the image. So the facts get their own contract rather
 * than being smuggled into the recognition one — and they are still gated by
 * deterministic validation, still surfaced as editable, and still confirmed by
 * the user before anything is logged.
 *
 * No @prisma/client imports — every vocabulary pinned here, same anti-corruption
 * rule as the other two contracts.
 */

export const OCR_CONTRACT_VERSION = 1;

/** Fields the platform can report as missing. Pinned vocabulary — never a free string. */
export type NutritionLabelField =
  'productName' | 'servingSize' | 'servingsPerContainer' | 'calories' | 'protein' | 'carbs' | 'fat';

/** Normalized serving unit. 'unit' = the label used something we cannot convert to mass (e.g. "1 bar"). */
export type ServingUnit = 'g' | 'ml' | 'unit';

/**
 * Which quantity the printed numbers refer to. European labels routinely print
 * per-100g (sometimes both); US/LATAM labels usually print per-serving. The
 * platform converts to per-serving deterministically — see `label-parser.ts`.
 */
export type LabelBasis = 'SERVING' | 'HUNDRED_G';

/**
 * The canonical, normalized nutrition label — the ONLY shape any OCR provider's
 * output becomes, and the only one that leaves the vision domain. Every value is
 * PER SERVING and in canonical units by the time it reaches this shape.
 */
export interface NutritionLabel {
  productName: string | null;
  servingSize: number;
  servingUnit: ServingUnit;
  servingsPerContainer: number | null;
  /** Per serving, kcal. */
  calories: number;
  /** Per serving, grams. */
  protein: number;
  carbs: number;
  fat: number;
  /** 0..1 — the provider's own transcription confidence, before the platform's completeness/validation weighting. */
  confidence: number;
  /** Required fields the provider could not read. Drives completeness scoring and which UI fields open for editing. */
  missingFields: NutritionLabelField[];
  /** providerId that produced the extraction (audit/eval attribution). */
  source: string;
  version: number;
}

/**
 * What an OCRProvider returns: the label's text, transcribed VERBATIM into typed
 * slots. Deliberately strings, not numbers.
 *
 * Every messy real-world normalization — decimal commas, kJ->kcal, "2/3 cup
 * (55g)", "por 100 g" basis, thousands separators — happens in the platform's
 * PURE parser (`label-parser.ts`), never in the provider. Three reasons:
 *   1. Determinism at the boundary: the same transcription always parses to the
 *      same numbers, even though the provider that produced it is probabilistic.
 *   2. Every provider benefits from one parser; an on-device OCR adapter (which
 *      returns raw text and can do no reasoning) fits the same port.
 *   3. Arithmetic done by a model is unverifiable; arithmetic done by a pure
 *      function is unit-tested.
 */
export interface RawLabelFields {
  /** "" (never null) when the provider could not find the field — keeps the provider schema simple and non-nullable. */
  productName: string;
  servingSize: string;
  servingsPerContainer: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  /** Verbatim basis text, e.g. "per serving" / "por 100 g" / "". */
  basis: string;
  /** 0..1, the provider's own confidence in the transcription. */
  confidence: number;
}

export interface LabelExtraction {
  providerId: string;
  model: string;
  providerVersion: string;
  fields: RawLabelFields;
  latencyMs: number;
  /** Audit only; never consumed downstream, never a vendor payload leak. */
  raw?: unknown;
}
