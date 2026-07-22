import { CoachingContext, CtxWeek } from '../nutrition-state/types/coaching-context';
import { COACH_OUTPUT_VERSION, WeeklyCoachOutput } from './types/weekly-coach';

/**
 * The DETERMINISTIC weekly coach — a pure function of the CoachingContext. It is
 * both the source of truth for the coaching STRUCTURE (summary / diagnosis /
 * next action / optional follow-up) and the fallback when no model is available
 * or a model call fails. A model adapter only rephrases these grounded sections.
 *
 * It consumes the contract ONLY: no Prisma, no raw logs, no recomputation. The
 * diagnosis/action come from the review's already-decided primary reason; the
 * numbers come from the ledger week already in the contract.
 *
 * Returns null when there is no completed week to analyze yet.
 */
export function buildDeterministicCoach(ctx: CoachingContext): WeeklyCoachOutput | null {
  const review = ctx.review;
  if (!review) return null;

  const week = ctx.history.weeks[0]; // the last completed week = the review week
  const primary = review.nextPriority?.reason ?? review.biggestOpportunity ?? 'STEADY';
  const advice = adviceFor(primary, ctx, week);

  return {
    summary: buildSummary(review.weekStart, week),
    diagnosis: advice.diagnosis,
    nextAction: advice.action,
    optionalFollowUp: buildFollowUp(ctx),
    meta: {
      source: 'deterministic',
      outputVersion: COACH_OUTPUT_VERSION,
      promptVersion: null,
      grounding: {
        weekStart: review.weekStart,
        primaryReason: primary,
        nextPriorityBasis: review.nextPriority?.basis ?? null,
        biggestImprovement: review.biggestImprovement,
        contractVersion: ctx.meta.version,
      },
    },
  };
}

function buildSummary(weekStart: string, week: CtxWeek | undefined): string {
  const adh = week?.adherenceScore ?? null;
  const nut = week?.nutritionScore ?? null;
  const days = week?.daysLogged ?? 0;
  return `Semana del ${weekStart}: adherencia ${fmt(adh)}, nutrición ${fmt(nut)}, ${days}/7 días registrados.`;
}

interface Advice {
  diagnosis: string;
  action: string;
}

/** Grounded, specific coaching per structured reason. The one place fallback copy lives. */
function adviceFor(reason: string, ctx: CoachingContext, week: CtxWeek | undefined): Advice {
  const proteinTarget = ctx.targets.proteinG;
  const calTarget = ctx.targets.calories;
  const avgProtein = week?.avgProtein ?? null;
  const proteinGap = avgProtein !== null ? Math.max(10, Math.round(proteinTarget - avgProtein)) : 25;

  switch (reason) {
    case 'PROTEIN_CHRONIC_LOW':
      return {
        diagnosis:
          avgProtein !== null
            ? `La proteína estuvo por debajo de tu meta casi toda la semana (promedio ${Math.round(avgProtein)}g vs meta ${proteinTarget}g).`
            : `La proteína estuvo por debajo de tu meta casi toda la semana.`,
        action: `Suma ${proteinGap}g de proteína en el desayuno (huevos, yogur griego o proteína en polvo) y revisa de nuevo la próxima semana.`,
      };
    case 'WEEKEND_DRIFT':
      return {
        diagnosis: 'Tus fines de semana sumaron bastantes más calorías que tus días de semana.',
        action:
          'Planea sábado y domingo con las mismas comidas base que entre semana; deja una sola comida libre, no dos días libres.',
      };
    case 'BREAKFAST_SKIPPED':
      return {
        diagnosis: 'Saltaste el desayuno la mayoría de los días, lo que suele disparar el hambre en la tarde.',
        action: `Desayuna con ~30g de proteína antes de media mañana (por ejemplo 3 huevos o 200g de yogur griego).`,
      };
    case 'LOW_LOGGING_CONSISTENCY':
      return {
        diagnosis: `Registraste pocos días esta semana (${week?.daysLogged ?? 0}/7), así que los datos todavía no son concluyentes.`,
        action: 'Registra al menos una comida cada día esta semana; la consistencia pesa más que la perfección.',
      };
    case 'LOW_ADHERENCE_WEEK':
      return {
        diagnosis: `Tu adherencia cayó esta semana (score ${fmt(week?.adherenceScore ?? null)}/100).`,
        action: 'Elige un solo hábito para sostener siete días seguidos —registrar el desayuno— y construye desde ahí.',
      };
    case 'PLATEAU_SUSPECTED':
      return {
        diagnosis: 'Tu peso lleva días plano pese a buena adherencia: es un plateau real, no falta de esfuerzo.',
        action: `Reduce ~200 kcal diarias (de ${calTarget} a ${calTarget - 200}) y reevalúa en dos semanas antes de recortar más.`,
      };
    case 'STEADY':
      return {
        diagnosis: 'Semana sólida: sin alertas de comportamiento y tus métricas se sostienen.',
        action: 'Mantén tu patrón actual de comidas y registro; no cambies nada esta semana.',
      };
    default:
      return {
        diagnosis: `Tu principal foco esta semana es ${reason}.`,
        action: 'Prioriza esa área en tus próximas comidas y registra para confirmar el progreso.',
      };
  }
}

/** Acknowledge an improvement (or a resolved issue) when the contract shows one. */
function buildFollowUp(ctx: CoachingContext): string | null {
  const review = ctx.review!;
  const improvement = review.biggestImprovement ? IMPROVEMENT_SENTENCE[review.biggestImprovement] : null;
  if (improvement) return improvement;

  const resolved = review.followUp.resolved[0];
  if (resolved) {
    const label = ISSUE_SHORT[resolved.issue] ?? resolved.issue;
    return `Cerraste ${label} que arrastrabas de semanas anteriores.`;
  }
  return null;
}

const IMPROVEMENT_SENTENCE: Record<string, string> = {
  ADHERENCE_IMPROVED: 'Reconoce el avance: tu adherencia mejoró frente a la semana pasada.',
  NUTRITION_IMPROVED: 'Tu calidad nutricional subió respecto a la semana previa.',
  LOGGING_STREAK_IMPROVED: 'Tu racha de registro creció esta semana.',
  PROTEIN_STREAK_IMPROVED: 'Encadenaste más días cumpliendo tu proteína.',
  WEIGHT_TREND_IMPROVED: 'Tu tendencia de peso mejoró hacia tu objetivo.',
};

const ISSUE_SHORT: Record<string, string> = {
  PROTEIN_CHRONIC_LOW: 'la proteína baja',
  WEEKEND_DRIFT: 'el descontrol de fin de semana',
  BREAKFAST_SKIPPED: 'saltarte el desayuno',
  LOW_LOGGING_CONSISTENCY: 'el registro irregular',
  LOW_ADHERENCE_WEEK: 'la baja adherencia',
  PLATEAU_SUSPECTED: 'el plateau',
};

function fmt(x: number | null): string {
  return x === null ? '—' : String(x);
}
