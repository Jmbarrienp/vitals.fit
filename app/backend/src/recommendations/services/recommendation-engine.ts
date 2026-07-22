import { BehaviorFlag, GoalType, PlateauStatus, UserNutritionState } from '@prisma/client';
import {
  RecommendationInput,
  RecommendationReason,
  REASON_META,
  StructuredRecommendation,
} from '../recommendation-reason';

const MIN_WEIGHT_POINTS = 3; // mirror the rollup's gate before any plan change
const FAST_LOSS_KG_WK = -0.9; // losing faster than this = protect muscle
const PLATEAU_CUT_KCAL = -200;
const SAFETY_BUMP_KCAL = 100;

/**
 * THE engine. Two pure entry points, one shared reason vocabulary. Neither
 * recomputes a metric — they read the rollup-sourced `input` and pick the single
 * highest-impact recommendation. This is the only place recommendation text and
 * reason codes are decided.
 */

function build(
  reason: RecommendationReason,
  message: string,
  extra?: { calorieAdjustment?: number; requiresConfirmation?: boolean },
): StructuredRecommendation {
  const meta = REASON_META[reason];
  return {
    reason,
    message,
    type: meta.type,
    priority: meta.priority,
    calorieAdjustment: extra?.calorieAdjustment,
    requiresConfirmation: extra?.requiresConfirmation ?? false,
  };
}

/**
 * Daily nudge channel (meal.logged + HTTP generate fallback). Returns exactly
 * ONE recommendation — the highest-impact issue, never a list. Order = impact:
 * a real plateau and a bad week beat today's micro-state, which beats streak
 * reinforcement, which beats the generic floor. Messages preserved verbatim from
 * the tuned V1 rules; only the structured reason is new.
 */
export function decideNudge(input: RecommendationInput): StructuredRecommendation {
  const { today, targets, state } = input;
  const calLogged = today.caloriesLogged;
  const calTarget = targets.calories;
  const calRemaining = calTarget - calLogged;
  const protRemaining = Math.round(targets.proteinG - today.proteinG);
  const meals = today.mealsLogged;
  const streak = state.loggingStreak;
  const pct = calTarget > 0 ? Math.round((calLogged / calTarget) * 100) : 0;
  const flags = state.behaviorFlags;

  // V2 insight (highest value, rare): a real plateau. Pure consumer of the rollup.
  if (state.plateauStatus === PlateauStatus.PLATEAU_SUSPECTED)
    return build(
      RecommendationReason.PLATEAU_SUSPECTED,
      'Tu adherencia viene alta pero tu peso lleva días plano. Suele ser un plateau normal — probablemente toque ajustar calorías, no esforzarte más.',
    );

  if (meals === 0)
    return build(
      RecommendationReason.NO_MEALS_LOGGED,
      'Empieza registrando el desayuno — los primeros datos del día son los más importantes.',
    );
  if (calLogged > calTarget + 200)
    return build(
      RecommendationReason.OVER_TARGET,
      `Hoy te pasaste ${calLogged - calTarget} kcal de tu meta. Sin drama — mañana retomas el plan.`,
    );
  if (calLogged > calTarget)
    return build(RecommendationReason.TARGET_REACHED, 'Llegaste a tu meta calórica por hoy. Buen trabajo.');
  if (pct >= 85 && meals >= 3)
    return build(
      RecommendationReason.CALORIES_REMAINING,
      `Estás al ${pct}% de tu meta. Casi llegas — una comida pequeña puede completar el día.`,
    );
  if (protRemaining > 40)
    return build(
      RecommendationReason.PROTEIN_GAP_TODAY,
      `Te faltan ${protRemaining}g de proteína para hoy. Agrega una fuente proteica en tu próxima comida.`,
    );
  if (calRemaining > 500 && meals >= 3)
    return build(
      RecommendationReason.CALORIES_REMAINING,
      `Llevas ${meals} comidas pero te quedan ${calRemaining} kcal. Considera un snack proteico.`,
    );
  if (streak >= 14)
    return build(
      RecommendationReason.STREAK_MILESTONE,
      `${streak} días seguidos. Eso ya no es motivación — es un hábito.`,
    );
  if (streak >= 7)
    return build(
      RecommendationReason.STREAK_MILESTONE,
      'Una semana completa trackeando. La consistencia es lo que más importa.',
    );
  if (state.adherencePct7d < 40)
    return build(
      RecommendationReason.LOW_ADHERENCE_WEEK,
      'Esta semana fue difícil. No necesitas ser perfecto — solo registrar un poco cada día ya ayuda.',
    );
  if (state.weightTrendKgWk !== null && input.goal === 'lose' && state.weightTrendKgWk < -0.1)
    return build(
      RecommendationReason.TREND_ON_TRACK,
      'Tus datos muestran progreso en la dirección correcta. Sigue así.',
    );

  // Longitudinal habit insights — consumers of behaviorFlags, beat the floor.
  if (flags.includes(BehaviorFlag.PROTEIN_CHRONIC_LOW))
    return build(
      RecommendationReason.PROTEIN_CHRONIC_LOW,
      'Vienes varios días por debajo de tu proteína objetivo. Subirla un poco protege tu músculo mientras avanzas.',
    );
  if (flags.includes(BehaviorFlag.WEEKEND_OVEREATING))
    return build(
      RecommendationReason.WEEKEND_DRIFT,
      'Tus fines de semana suman bastante más que tus días de semana. Planear sábado y domingo puede ser el ajuste que falta.',
    );
  if (flags.includes(BehaviorFlag.BREAKFAST_SKIPPED))
    return build(
      RecommendationReason.BREAKFAST_SKIPPED,
      'Vienes saltándote el desayuno casi siempre. Si llegas con hambre en la tarde, un desayuno con proteína ayuda a controlar el resto del día.',
    );
  if (flags.includes(BehaviorFlag.LOW_LOGGING_CONSISTENCY))
    return build(
      RecommendationReason.LOW_LOGGING_CONSISTENCY,
      'Esta semana registraste pocos días. No busques perfección — registrar aunque sea una comida al día mantiene tus datos vivos.',
    );

  return build(RecommendationReason.STEADY, `Llevas ${calLogged} de ${calTarget} kcal hoy (${pct}%). Vas bien.`);
}

/**
 * Plan-adjustment channel (weight.updated). Returns a calorie-changing
 * recommendation only when the rollup justifies it, or null. The critical
 * upgrade over the old handler: a flat weight trend alone is NOT enough to cut
 * calories — it must be PLATEAU_SUSPECTED, which the rollup only sets when
 * adherence is genuinely high. A non-adherent user is never told to eat less.
 */
export function decidePlanAdjustment(input: RecommendationInput): StructuredRecommendation | null {
  const { goal, targets, state } = input;
  if (state.weightDataPoints < MIN_WEIGHT_POINTS) return null;

  if (goal === 'lose' && state.plateauStatus === PlateauStatus.PLATEAU_SUSPECTED) {
    return build(
      RecommendationReason.PLATEAU_SUSPECTED,
      `Tu peso lleva días estable con buena adherencia. Sugerimos reducir ${Math.abs(PLATEAU_CUT_KCAL)} kcal (de ${targets.calories} a ${targets.calories + PLATEAU_CUT_KCAL}) para retomar el progreso.`,
      { calorieAdjustment: PLATEAU_CUT_KCAL, requiresConfirmation: true },
    );
  }
  if (goal === 'lose' && state.weightTrendKgWk !== null && state.weightTrendKgWk < FAST_LOSS_KG_WK) {
    return build(
      RecommendationReason.LOSING_TOO_FAST,
      `Estás perdiendo peso más rápido de lo recomendado. Sugerimos aumentar ${SAFETY_BUMP_KCAL} kcal para proteger tu masa muscular.`,
      { calorieAdjustment: SAFETY_BUMP_KCAL, requiresConfirmation: true },
    );
  }
  if (goal === 'gain' && state.trendStatus === 'stalled') {
    return build(
      RecommendationReason.GAIN_STALLED,
      `Sin progreso de ganancia en los últimos días. Sugerimos aumentar ${SAFETY_BUMP_KCAL} kcal (de ${targets.calories} a ${targets.calories + SAFETY_BUMP_KCAL}).`,
      { calorieAdjustment: SAFETY_BUMP_KCAL, requiresConfirmation: true },
    );
  }
  return null;
}

const GOAL_DIR: Record<GoalType, RecommendationInput['goal']> = {
  LOSE_FAT: 'lose',
  GAIN_MUSCLE: 'gain',
  MAINTAIN: 'maintain',
  RECOMPOSITION: 'maintain',
  HEALTH_WELLNESS: 'maintain',
};

/**
 * Build the engine input straight from the rollup row + today's intake. Used by
 * the weight.updated handler and the HTTP path — both read the cached state, so
 * the trend/adherence numbers come from a single source of truth.
 */
export function stateToInput(args: {
  goal: GoalType | null;
  state: UserNutritionState;
  today: { caloriesLogged: number; proteinG: number; mealsLogged: number };
}): RecommendationInput {
  const { goal, state, today } = args;
  return {
    goal: goal ? GOAL_DIR[goal] : 'maintain',
    targets: {
      calories: state.calorieTarget ?? 2000,
      proteinG: state.proteinTargetG ?? 150,
    },
    today,
    state: {
      plateauStatus: state.plateauStatus,
      behaviorFlags: state.behaviorFlags,
      trendStatus: state.trendStatus,
      adherenceScore: state.adherenceScore,
      adherencePct7d: state.adherencePct7d ?? 0,
      loggingStreak: state.loggingStreak,
      weightTrendKgWk: state.weightTrendKgWk,
      weightDataPoints: state.weightDataPoints,
    },
  };
}
