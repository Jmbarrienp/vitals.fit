import { CoachingContext, COACHING_CONTRACT_VERSION } from '../../nutrition-state/types/coaching-context';
import { NutritionPlan } from '../../planner/types/nutrition-plan';
import { MealPlan } from '../../meal-planner/types/meal-plan';
import { WeeklyCoachOutput } from '../../coach/types/weekly-coach';
import {
  COPILOT_CONTRACT_NAME,
  COPILOT_CONTRACT_VERSION,
  CopilotFocusArea,
  CopilotNextAction,
  CopilotSession,
  CopilotSuggestion,
  SilencedModule,
} from '../types/copilot-contract';

/**
 * The Copilot session composer (V5.0) — PURE. Takes every engine's ALREADY
 * PRODUCED output and coordinates one coherent session. Composition only:
 * every string in the output is quoted from its owner; the composer's own
 * contribution is limited to ORDER (who speaks first), PRIORITY (which single
 * next action), SILENCE (who stays quiet, recorded), and REDUNDANCY (the same
 * reason never speaks twice).
 *
 * The focus ladder is ordered by a simple principle: the platform's whole
 * intelligence runs on logged data, so a broken logging loop outranks
 * everything; a live pledge outranks new advice (the user's own word comes
 * before ours); a persisting issue outranks a new plan; a plan change outranks
 * maintenance. Deterministic: same inputs, same session.
 */

/** An active recommendation, projected into contract vocabulary (never a Prisma row). */
export interface ActiveRecommendation {
  message: string;
  reason: string | null;
  status: string; // PENDING | COMMITTED
  priority: number;
}

export interface ComposerInputs {
  ctx: CoachingContext;
  plan: NutritionPlan;
  mealPlan: MealPlan;
  coach: WeeklyCoachOutput | null; // the DETERMINISTIC coach (LLM rephrase not consumed here)
  recommendations: ActiveRecommendation[];
}

const MAX_SUGGESTIONS = 3;

export function composeSession(inputs: ComposerInputs, generatedAt: string): CopilotSession {
  const { ctx, plan, mealPlan, coach, recommendations } = inputs;
  const silenced: SilencedModule[] = [];

  const focus = deriveFocus(ctx, plan);
  const nextAction = deriveNextAction(focus.area, ctx, plan, coach, recommendations, silenced);

  // Redundancy rule: the coach's narrative is silenced when its next action
  // targets the SAME reason the chosen action already covers — one voice per
  // problem. The coach still exists at its own endpoint; the SESSION dedupes.
  let coachSummary: CopilotSession['coachSummary'] = null;
  if (coach) {
    const coachDuplicates =
      nextAction.source !== 'WEEKLY_COACH' && normalized(coach.nextAction) === normalized(nextAction.action);
    if (coachDuplicates) {
      silenced.push({
        module: 'WEEKLY_COACH',
        reason: 'su próxima acción repite la acción elegida — una sola voz por problema',
      });
    } else {
      coachSummary = { summary: coach.summary, diagnosis: coach.diagnosis, source: coach.meta.source };
    }
  } else {
    silenced.push({ module: 'WEEKLY_COACH', reason: 'aún no hay una semana completada que coachear' });
  }

  // Meal suggestions: verbatim from the Meal Planner, capped. Silenced entirely
  // when the focus is LOGGING — suggesting meals to someone who isn't logging
  // is noise before the loop is repaired.
  let mealSuggestions: CopilotSuggestion[] = [];
  if (focus.area === 'LOGGING') {
    silenced.push({
      module: 'MEAL_PLANNER',
      reason: 'el foco es reparar el registro — sugerir comidas antes de eso es ruido',
    });
  } else {
    mealSuggestions = mealPlan.meals.slice(0, MAX_SUGGESTIONS).map((m: { name: string; targetCalories?: number }) => ({
      source: 'MEAL_PLANNER' as const,
      text: m.name,
      code: null,
    }));
  }

  // Vision suggestions are AFFORDANCE pointers (which module can help now),
  // never nutrition: scanning lowers logging friction, so Vision speaks when
  // logging needs help and stays quiet otherwise.
  const visionSuggestions: CopilotSuggestion[] = [];
  if (focus.area === 'LOGGING' || ctx.today.mealsLogged === 0) {
    visionSuggestions.push({
      source: 'VISION',
      text: 'Registra tu próxima comida con la cámara o el código de barras — menos fricción que escribirla',
      code: 'VISION_CAPTURE_AFFORDANCE',
    });
  } else {
    silenced.push({ module: 'VISION', reason: 'el registro fluye — no hace falta empujar la cámara hoy' });
  }

  const plannerRecommendations: CopilotSuggestion[] = plan.decisions.slice(0, MAX_SUGGESTIONS).map((d) => ({
    source: 'PLANNER' as const,
    text: d.explanation,
    code: d.code,
  }));

  return {
    meta: {
      contract: COPILOT_CONTRACT_NAME,
      version: COPILOT_CONTRACT_VERSION,
      generatedAt,
      consumes: {
        coachingContext: COACHING_CONTRACT_VERSION,
        planner: plan.meta.version,
        mealPlanner: mealPlan.meta.version,
      },
    },
    currentFocus: focus,
    currentGoals: {
      goal: ctx.user.goal,
      calories: ctx.targets.calories,
      proteinG: ctx.targets.proteinG,
      todayCalories: ctx.today.caloriesLogged,
      todayProteinG: ctx.today.proteinG,
      mealsLoggedToday: ctx.today.mealsLogged,
    },
    currentPlan: {
      posture: plan.posture,
      headlineCode: plan.headline.code,
      headlineExplanation: plan.headline.explanation,
      decisions: plan.decisions.length,
      reviewWindowDays: plan.reviewWindowDays,
    },
    activeCommitments: ctx.commitments.active.map((c) => ({
      message: c.message,
      reason: c.reason,
      expiresAt: c.expiresAt,
    })),
    unresolvedIssues: (ctx.review?.followUp.persisting ?? []).map((i) => ({
      issue: i.issue,
      weeksActive: i.weeksActive,
      intervention: i.intervention,
    })),
    recentProgress: {
      trend: ctx.currentState.trendStatus,
      adherence7d: ctx.currentState.adherencePct7d,
      loggingStreakDays: ctx.currentState.streaks.loggingDays,
      lastWeek: ctx.review
        ? {
            adherenceScore: ctx.history.weeks[0]?.adherenceScore ?? null,
            biggestImprovement: ctx.review.biggestImprovement,
          }
        : null,
    },
    mealSuggestions,
    visionSuggestions,
    plannerRecommendations,
    coachSummary,
    nextAction,
    pendingQuestions: deriveQuestions(ctx),
    confidence: confidenceLabel(ctx),
    silenced,
  };
}

/** The focus ladder — first match wins, each rung explained. */
export function deriveFocus(ctx: CoachingContext, plan: NutritionPlan): { area: CopilotFocusArea; reason: string } {
  if (ctx.today.mealsLogged === 0 && ctx.currentState.daysLogged7d <= 2) {
    return {
      area: 'LOGGING',
      reason: `sin comidas hoy y solo ${ctx.currentState.daysLogged7d}/7 días registrados — toda la inteligencia depende de que el registro fluya`,
    };
  }
  if (ctx.commitments.active.length > 0) {
    return {
      area: 'COMMITMENT',
      reason: `hay ${ctx.commitments.active.length} compromiso(s) vivo(s) — la palabra del usuario va antes que un consejo nuevo`,
    };
  }
  if ((ctx.review?.followUp.persisting.length ?? 0) > 0) {
    const worst = ctx.review!.followUp.persisting[0];
    return {
      area: 'ISSUE',
      reason: `'${worst.issue}' lleva ${worst.weeksActive} semana(s) activo — un problema persistente supera a un plan nuevo`,
    };
  }
  // The planner's own vocabulary: EVOLVING = a dimension should change. A
  // concrete numeric adjustment also counts, whatever the posture label.
  if (plan.posture === 'EVOLVING' || plan.headline.adjustment !== null) {
    return {
      area: 'ADJUSTMENT',
      reason: `el planner decidió '${plan.headline.code}' este ciclo — aplicar el cambio es la prioridad`,
    };
  }
  return { area: 'MAINTAIN', reason: 'todo en verde — proteger la racha es el mejor movimiento' };
}

/** One single next action; owner chosen by the focus, priority explained. */
function deriveNextAction(
  area: CopilotFocusArea,
  ctx: CoachingContext,
  plan: NutritionPlan,
  coach: WeeklyCoachOutput | null,
  recommendations: ActiveRecommendation[],
  silenced: SilencedModule[],
): CopilotNextAction {
  if (area === 'LOGGING') {
    return {
      source: 'COACHING_CONTEXT',
      action: 'Registra tu próxima comida — con eso el resto de la plataforma vuelve a poder ayudarte',
      reason: 'el circuito de datos está roto; ninguna otra acción es medible hasta repararlo',
    };
  }
  if (area === 'COMMITMENT') {
    const commitment = ctx.commitments.active[0];
    return {
      source: 'COMMITMENTS',
      action: commitment.message,
      reason: `compromiso vivo (expira ${commitment.expiresAt}) — se honra antes de dar consejos nuevos`,
    };
  }
  const topRec = recommendations[0];
  if (topRec) {
    // A pending nudge already targets today's priority issue; anything else would double-message.
    if (recommendations.length > 1) {
      silenced.push({
        module: 'RECOMMENDATIONS',
        reason: `${recommendations.length - 1} recomendación(es) adicionales retenidas — una acción a la vez`,
      });
    }
    return {
      source: 'RECOMMENDATIONS',
      action: topRec.message,
      reason: 'la recomendación activa de mayor prioridad ya apunta al problema vigente',
    };
  }
  if (coach) {
    return {
      source: 'WEEKLY_COACH',
      action: coach.nextAction,
      reason: 'sin nudges activos — la próxima acción del coach semanal es la más fundamentada',
    };
  }
  return {
    source: 'PLANNER',
    action: plan.headline.explanation,
    reason: 'sin coach ni nudges todavía — la decisión de cabecera del planner es la guía disponible',
  };
}

function deriveQuestions(ctx: CoachingContext): string[] {
  const out: string[] = [];
  if (ctx.currentState.weight.dataPoints === 0) {
    out.push('¿Cuál es tu peso actual? Sin él, la tendencia y el plateau no son medibles.');
  }
  if (ctx.currentState.weight.dataPoints > 0 && ctx.currentState.weight.trendKgPerWeek === null) {
    out.push('Registra tu peso esta semana — con un punto más ya se puede estimar la tendencia.');
  }
  return out;
}

/** Evidence label: completed weeks + recent logging density. A count, not a probability. */
export function confidenceLabel(ctx: CoachingContext): 'ALTA' | 'MEDIA' | 'BAJA' {
  const weeks = ctx.history.weeks.length;
  const days = ctx.currentState.daysLogged7d;
  if (weeks >= 3 && days >= 5) return 'ALTA';
  if (weeks >= 1 && days >= 3) return 'MEDIA';
  return 'BAJA';
}

function normalized(s: string): string {
  return s.trim().toLowerCase();
}
