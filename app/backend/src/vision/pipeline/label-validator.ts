import { NutritionLabel } from '../types/ocr-contract';

/**
 * Deterministic validation for a transcribed nutrition label (Phase 2D.2 V3.2).
 * PURE and total — the gate that stands between OCR output and Nutrition, the
 * same role `response-validator.ts` plays for `RecognitionResult`.
 *
 * Two tiers, deliberately separated:
 *
 *  - HARD ERRORS make the label unusable: negative macros, a non-positive
 *    serving, values outside what the platform can even store, or a physically
 *    impossible one (more macro mass than the serving weighs). These fail the
 *    scan safe — it degrades to manual entry rather than proposing nonsense.
 *
 *  - PLAUSIBILITY is a 0..1 signal, never a rejection. An Atwater mismatch
 *    (4·protein + 4·carbs + 9·fat should approximate the printed calories) is
 *    the strongest available tell that OCR misread a digit — "40g protein" for
 *    "4.0g" shows up here immediately. But real labels legitimately drift from
 *    Atwater via fiber, polyols, rounding, and alcohol, so it lowers confidence
 *    (pushing the user toward REVIEW) instead of discarding a valid label.
 *
 * Note this is transcription-accuracy checking, NOT nutrition intelligence: it
 * asks "did we read the label correctly", never "is this food good for you".
 * Scoring, planning and coaching remain entirely outside the vision domain.
 */

export interface LabelValidationOutcome {
  valid: boolean;
  errors: string[];
  /** 0..1 — how internally consistent the numbers are. Present even when valid; feeds confidence. */
  plausibility: number;
}

/**
 * Ceilings mirror `ConfirmScanItemDto`'s @Max constraints exactly. Without this
 * alignment the platform could propose a label that its own confirm endpoint
 * would reject with a 400 — a dead end for the user at the last step.
 */
const MAX_CALORIES = 10_000;
const MAX_PROTEIN = 1_000;
const MAX_CARBS = 2_000;
const MAX_FAT = 500;
const MAX_SERVING = 5_000;

/** Mass tolerance: printed macros are rounded, so allow a small overshoot before calling a label impossible. */
const MASS_TOLERANCE = 1.05;
/** Atwater tolerance before plausibility starts falling — generous, because fiber and rounding are legitimate. */
const ATWATER_TOLERANCE = 0.25;

export function validateNutritionLabel(label: NutritionLabel): LabelValidationOutcome {
  const errors: string[] = [];

  if (!isNonNegative(label.calories)) errors.push('calories must be a number >= 0');
  if (!isNonNegative(label.protein)) errors.push('protein must be a number >= 0');
  if (!isNonNegative(label.carbs)) errors.push('carbs must be a number >= 0');
  if (!isNonNegative(label.fat)) errors.push('fat must be a number >= 0');

  if (!isFiniteNumber(label.servingSize) || label.servingSize <= 0) {
    errors.push('servingSize must be a number > 0');
  }

  if (label.calories > MAX_CALORIES) errors.push(`calories exceeds the maximum the platform accepts (${MAX_CALORIES})`);
  if (label.protein > MAX_PROTEIN) errors.push(`protein exceeds the maximum the platform accepts (${MAX_PROTEIN})`);
  if (label.carbs > MAX_CARBS) errors.push(`carbs exceeds the maximum the platform accepts (${MAX_CARBS})`);
  if (label.fat > MAX_FAT) errors.push(`fat exceeds the maximum the platform accepts (${MAX_FAT})`);
  if (label.servingSize > MAX_SERVING) errors.push(`servingSize exceeds the maximum the platform accepts (${MAX_SERVING})`);

  // Mass conservation — only meaningful for a mass serving. 'ml' is left out on
  // purpose: density is not 1 for every liquid, and a false impossible-label
  // rejection is worse than a missed one (the user still reviews the numbers).
  if (label.servingUnit === 'g' && label.servingSize > 0) {
    const macroMass = label.protein + label.carbs + label.fat;
    if (macroMass > label.servingSize * MASS_TOLERANCE) {
      errors.push(`macros weigh more than the serving (${round1(macroMass)}g of macros in a ${label.servingSize}g serving)`);
    }
  }

  if (errors.length > 0) return { valid: false, errors, plausibility: 0 };
  return { valid: true, errors: [], plausibility: atwaterPlausibility(label) };
}

/**
 * How closely the printed calories match the printed macros. 1.0 = within
 * tolerance; decays toward 0 as the mismatch grows. A label with no calories and
 * no macros (all zeroes) carries no signal either way — treated as neutral.
 */
export function atwaterPlausibility(label: NutritionLabel): number {
  const derived = 4 * label.protein + 4 * label.carbs + 9 * label.fat;
  if (label.calories === 0 && derived === 0) return 1;
  // A zero on either side alone is a real inconsistency (e.g. "0 kcal" with 10g fat).
  if (label.calories === 0 || derived === 0) return 0.3;

  const relativeError = Math.abs(derived - label.calories) / label.calories;
  if (relativeError <= ATWATER_TOLERANCE) return 1;
  // Linear decay: at 100% error the signal is exhausted.
  return Math.max(0, 1 - (relativeError - ATWATER_TOLERANCE) / (1 - ATWATER_TOLERANCE));
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function isNonNegative(x: unknown): boolean {
  return isFiniteNumber(x) && x >= 0;
}
const round1 = (n: number) => Math.round(n * 10) / 10;
