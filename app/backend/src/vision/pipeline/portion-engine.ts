import { PortionEstimate, PortionSignal } from '../types/vision-contract';
import { clampGrams } from './portion';
import { computeBias, historyWeight, priorConfidence, selectPrior } from './portion-priors';

/**
 * Portion Estimation Engine (Nutrition Vision V3.3) — the deterministic blend
 * of everything the platform knows about HOW MUCH this user eats of this food:
 *
 *   VISION            what the provider saw on the plate (corrected by the
 *                     user's own historical correction bias)
 *   USER_HISTORY      the median of the user's validated logs of this food
 *   PLANNER           what the active meal plan expects at this meal type
 *   CATALOG_DEFAULT   the food's default serving (when vision had no estimate)
 *
 * PURE. The engine receives already-fetched observations and returns a final
 * PortionEstimate plus a structured explanation. Claude only ever contributes
 * ONE signal (VISION); the platform owns the weights, the arithmetic, the
 * confidence and the decision. As the user logs more of a food, historyWeight
 * grows and the model's opinion matters progressively less — with no
 * retraining, no embeddings and no LLM memory. The user's goal deliberately
 * does NOT enter the blend directly: biasing perceived grams toward the target
 * would corrupt the adherence data every Phase 2 consumer depends on. The goal
 * is only represented through PLANNER, which already encodes it as planned
 * amounts.
 */

export interface PortionPriorInputs {
  /** user's validated portions of this food (grams), any meal type, most recent first */
  userFoodGrams: number[];
  /** the subset logged at the scan's suggested meal type */
  userFoodMealTypeGrams: number[];
  /** the active plan's typical amount for this food at this meal type, or null */
  plannerExpectedGrams: number | null;
  /** confirmedGrams/proposedGrams ratios from past PROVIDER_ESTIMATE confirmations */
  visionBiasRatios: number[];
}

export interface ResolvedPortion {
  portion: PortionEstimate;
  explanation: PortionSignal[];
}

/** Fixed, low weight: the plan says what SHOULD be on the plate, not what IS. */
const PLANNER_WEIGHT = 0.15;
/** Vision agreeing with a real prior is corroboration — small, capped bonus. */
const AGREEMENT_BONUS = 0.1;
const CONFIDENCE_CAP = 0.95;

export function resolvePortion(base: PortionEstimate, inputs: PortionPriorInputs | null): ResolvedPortion {
  // No signals beyond the base estimate -> pass it through untouched. A user
  // with no history sees exactly the pre-V3.3 behavior, by construction.
  if (!inputs) {
    return { portion: base, explanation: [baseSignal(base, null)] };
  }

  const prior = selectPrior(inputs.userFoodGrams, inputs.userFoodMealTypeGrams);
  const bias = computeBias(inputs.visionBiasRatios);

  const signals: PortionSignal[] = [baseSignal(base, bias)];

  if (prior) {
    const scopeNote = prior.scope === 'MEAL_TYPE' ? 'en esta comida' : 'de este alimento';
    signals.push({
      source: 'USER_HISTORY',
      grams: Math.round(prior.median),
      weight: round2(historyWeight(prior.n)),
      note: `mediana de tus últimos ${prior.n} registros ${scopeNote} (±${Math.round(prior.mad)}g)`,
    });
  }

  if (inputs.plannerExpectedGrams != null && inputs.plannerExpectedGrams > 0) {
    signals.push({
      source: 'PLANNER',
      grams: Math.round(inputs.plannerExpectedGrams),
      weight: PLANNER_WEIGHT,
      note: 'cantidad esperada por tu plan para esta comida',
    });
  }

  // Nothing beyond the base signal -> unchanged base, but the explanation shows why.
  if (signals.length === 1) {
    return { portion: { ...base, grams: signals[0].grams }, explanation: signals };
  }

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const grams = clampGrams(signals.reduce((sum, s) => sum + s.grams * s.weight, 0) / totalWeight);

  let confidence = base.confidence;
  if (prior) {
    confidence = Math.max(confidence, priorConfidence(prior));
    const vision = signals.find((s) => s.source === 'VISION');
    if (vision) {
      // Two independent instruments reading the same value corroborate each other.
      const tolerance = Math.max(2 * prior.mad, 0.15 * prior.median);
      if (Math.abs(vision.grams - prior.median) <= tolerance) {
        confidence = Math.min(CONFIDENCE_CAP, confidence + AGREEMENT_BONUS);
      }
    }
  }

  const historyW = prior ? historyWeight(prior.n) : 0;
  const method = !prior ? base.method : historyW > totalWeight - historyW ? 'USER_PRIOR' : 'BLENDED';

  return {
    portion: { grams, method, confidence: round2(confidence) },
    explanation: signals,
  };
}

/**
 * The base estimate as a signal. A PROVIDER_ESTIMATE is the model's opinion —
 * corrected by the learned bias when there is one; anything else
 * (SERVING_DEFAULT) is catalog knowledge, not perception.
 */
function baseSignal(base: PortionEstimate, bias: number | null): PortionSignal {
  if (base.method === 'PROVIDER_ESTIMATE') {
    const corrected = bias != null ? clampGrams(base.grams * bias) : base.grams;
    return {
      source: 'VISION',
      grams: corrected,
      weight: round2(base.confidence),
      note:
        bias != null && bias !== 1
          ? `estimación visual, ajustada ×${bias.toFixed(2)} según tus correcciones previas`
          : 'estimación visual del modelo',
    };
  }
  return {
    source: 'CATALOG_DEFAULT',
    grams: base.grams,
    weight: round2(base.confidence),
    note: 'porción por defecto del catálogo',
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
