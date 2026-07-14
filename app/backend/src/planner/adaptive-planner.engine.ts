import { CoachingContext, CtxWeek } from '../nutrition-state/types/coaching-context';
import {
  NutritionPlan,
  PLANNER_NAME,
  PLANNER_VERSION,
  PlanConfidence,
  PlanDecision,
  PlanDecisionCode,
  PlanDimension,
  PlanEvidence,
  PlanPosture,
} from './types/nutrition-plan';

/**
 * The Adaptive Nutrition Planner engine (Phase 2C.2). PURE and DETERMINISTIC:
 * `decidePlan(ctx)` is a function of the CoachingContext ONLY — same context in,
 * same plan out (only meta.generatedAt, which it copies from the context, varies).
 *
 * It CONSUMES platform truth (rollup scores, ledger weeks, review follow-up,
 * commitments) and never recalculates a score, reads a raw log, or duplicates the
 * recommendation engine. It requires LONGITUDINAL evidence: a calorie change needs
 * a sustained plateau across weeks, not one flat day.
 */

// ── thresholds (deterministic; aligned with the reactive engine's magnitudes) ──
const MIN_WEEKS_TO_PLAN = 2; // fewer completed weeks -> WAIT_FOR_MORE_DATA
const STALL_WEEKS_FOR_CHANGE = 2; // consecutive stalled weeks before a calorie change
const STALL_WEEKS_HIGH_CONF = 3; // >= this many -> HIGH confidence
const MIN_WEIGHT_POINTS = 3; // mirror the rollup/engine gate before touching calories
const HIGH_ADHERENCE = 70; // matches the rollup's plateau adherence gate
const FAST_LOSS_KG_WK = -0.9; // losing faster than this -> protect muscle
const FAST_GAIN_KG_WK = 0.55; // gaining faster than a lean bulk
const PLATEAU_CUT_KCAL = -200; // aligned with the engine's reactive plateau cut
const SAFETY_BUMP_KCAL = 100; // aligned with the engine's reactive protective bump
const GAIN_TRIM_KCAL = -150; // trim an overly fast bulk
const PROTEIN_LOW_RATIO = 0.9; // avgProtein below 90% of target = "low" that week
const PROTEIN_WELL_BELOW_RATIO = 0.6; // chronically far below -> target may be impractical
const PROTEIN_BUMP_G = 15; // protein target change magnitude
const CALORIE_REVIEW_DAYS = 14; // don't re-cut before two weeks
const WEEKLY_REVIEW_DAYS = 7; // stable / adherence-first / data cadence

interface Analysis {
  goal: 'lose' | 'gain' | 'maintain';
  weeksAnalyzed: number;
  stalledStreak: number;
  avgAdherence: number | null;
  highAdherence: boolean;
  commitmentsCompletedRecent: number;
  recentAvgProtein: number | null;
  proteinWellBelowStreak: number;
  weightTrend: number | null;
  weightPoints: number;
  plateauNow: boolean;
  fastLoss: boolean;
  fastGain: boolean;
}

export function decidePlan(ctx: CoachingContext): NutritionPlan {
  const a = analyze(ctx);

  // ── Global data gate: planning needs longitudinal evidence. ──
  if (a.weeksAnalyzed < MIN_WEEKS_TO_PLAN) {
    const wait = mk(
      'WAIT_FOR_MORE_DATA',
      'DATA',
      'LOW',
      `Aún no hay suficiente historia semanal para planear (${a.weeksAnalyzed} semana(s) completada(s)). Sigue registrando y reevaluamos la próxima semana.`,
      [ev('INSUFFICIENT_HISTORY', `${a.weeksAnalyzed} semana(s) completada(s); se necesitan ${MIN_WEEKS_TO_PLAN}`)],
      null,
      WEEKLY_REVIEW_DAYS,
    );
    return assemble(ctx, a, 'INSUFFICIENT_DATA', wait, [wait]);
  }

  const calories = decideCalories(a, ctx);
  const protein = decideProtein(a, ctx, calories);
  const intervention = decideIntervention(ctx);

  const decisions: PlanDecision[] = [calories, protein, ...(intervention ? [intervention] : [])];

  const adherenceFirst =
    calories.code === 'KEEP_PLAN' && calories.evidence.some((e) => e.code === 'LOW_ADHERENCE');
  const changes = decisions.filter((d) => isChange(d.code));

  let posture: PlanPosture;
  let headline: PlanDecision;
  if (adherenceFirst) {
    posture = 'ADHERENCE_FIRST';
    headline = calories;
  } else if (changes.length > 0) {
    posture = 'EVOLVING';
    headline = [...changes].sort((x, y) => headlineRank(x.code) - headlineRank(y.code))[0];
  } else {
    headline = calories;
    // Enough weeks to plan, but calories can't move yet (e.g. too few weight points).
    posture = calories.code === 'WAIT_FOR_MORE_DATA' ? 'INSUFFICIENT_DATA' : 'STABLE';
  }

  return assemble(ctx, a, posture, headline, decisions);
}

// ── evidence analysis (consumes ctx only) ──

function analyze(ctx: CoachingContext): Analysis {
  const weeks = ctx.history.weeks; // newest-first
  const goal = ctx.user.goal;
  const cs = ctx.currentState;
  const window = weeks.slice(0, 3);

  const notProgressing = (w: CtxWeek): boolean => {
    if (goal === 'lose') return w.trendStatus === 'stalled' || w.plateauStatus === 'PLATEAU_SUSPECTED';
    if (goal === 'gain') return w.trendStatus === 'stalled';
    return false; // maintain: a flat week is success, not a stall
  };

  const adhVals = window.map((w) => w.adherenceScore).filter((x): x is number => x !== null);
  const avgAdherence = adhVals.length ? avg(adhVals) : cs.adherenceScore;

  const proteinTarget = ctx.targets.proteinG;
  const protVals = window.map((w) => w.avgProtein).filter((x): x is number => x !== null);

  return {
    goal,
    weeksAnalyzed: weeks.length,
    stalledStreak: countLeading(weeks, notProgressing),
    avgAdherence,
    highAdherence: avgAdherence !== null && avgAdherence >= HIGH_ADHERENCE,
    commitmentsCompletedRecent: window.reduce((s, w) => s + w.commitmentsCompleted, 0),
    recentAvgProtein: protVals.length ? avg(protVals) : null,
    proteinWellBelowStreak: countLeading(
      weeks,
      (w) => w.avgProtein !== null && w.avgProtein < proteinTarget * PROTEIN_WELL_BELOW_RATIO,
    ),
    weightTrend: cs.weight.trendKgPerWeek,
    weightPoints: cs.weight.dataPoints,
    plateauNow: cs.plateauStatus === 'PLATEAU_SUSPECTED',
    fastLoss: cs.weight.trendKgPerWeek !== null && cs.weight.trendKgPerWeek < FAST_LOSS_KG_WK,
    fastGain: cs.weight.trendKgPerWeek !== null && cs.weight.trendKgPerWeek > FAST_GAIN_KG_WK,
  };
}

// ── per-dimension deciders ──

function decideCalories(a: Analysis, ctx: CoachingContext): PlanDecision {
  const target = ctx.targets.calories;

  if (a.weightPoints < MIN_WEIGHT_POINTS) {
    return mk(
      'WAIT_FOR_MORE_DATA',
      'CALORIES',
      'LOW',
      'Faltan registros de peso para ajustar calorías con seguridad; mantén el plan por ahora.',
      [ev('INSUFFICIENT_WEIGHT_DATA', `${a.weightPoints} registros de peso (se necesitan ${MIN_WEIGHT_POINTS})`)],
      null,
      WEEKLY_REVIEW_DAYS,
    );
  }

  if (a.goal === 'lose') {
    if (a.fastLoss) {
      return mk(
        'INCREASE_CALORIES',
        'CALORIES',
        a.weightPoints >= 4 ? 'HIGH' : 'MEDIUM',
        `Estás bajando más rápido de lo recomendado (${fmtKg(a.weightTrend)} kg/sem). Subir ${SAFETY_BUMP_KCAL} kcal (a ${target + SAFETY_BUMP_KCAL}) protege tu masa muscular.`,
        [ev('FAST_LOSS', `${fmtKg(a.weightTrend)} kg/sem`)],
        { calorieDelta: SAFETY_BUMP_KCAL, newCalorieTarget: target + SAFETY_BUMP_KCAL },
        CALORIE_REVIEW_DAYS,
      );
    }
    if (a.stalledStreak >= STALL_WEEKS_FOR_CHANGE) {
      if (a.plateauNow && a.highAdherence) {
        const evidence: PlanEvidence[] = [
          ev('PLATEAU_SUSTAINED', `${a.stalledStreak} semanas de peso estancado`),
          ev('HIGH_ADHERENCE', `adherencia ${round(a.avgAdherence)}/100 sostenida`),
        ];
        if (a.commitmentsCompletedRecent > 0)
          evidence.push(ev('COMMITMENTS_COMPLETED', `${a.commitmentsCompletedRecent} compromiso(s) cumplido(s)`));
        return mk(
          'REDUCE_CALORIES',
          'CALORIES',
          a.stalledStreak >= STALL_WEEKS_HIGH_CONF ? 'HIGH' : 'MEDIUM',
          `Tu peso lleva ${a.stalledStreak} semanas estable con adherencia alta: es un plateau real, no falta de esfuerzo. Reducir ${Math.abs(PLATEAU_CUT_KCAL)} kcal (a ${target + PLATEAU_CUT_KCAL}) retoma el progreso.`,
          evidence,
          { calorieDelta: PLATEAU_CUT_KCAL, newCalorieTarget: target + PLATEAU_CUT_KCAL },
          CALORIE_REVIEW_DAYS,
        );
      }
      // Sustained stall but adherence isn't high enough to trust the plan is the problem.
      return mk(
        'KEEP_PLAN',
        'CALORIES',
        'MEDIUM',
        'Tu peso está estancado, pero tu adherencia aún no es suficiente para saber si el plan falla. Mantén las calorías y prioriza la consistencia antes de recortar.',
        [
          ev('PLATEAU_SUSTAINED', `${a.stalledStreak} semanas estancado`),
          ev('LOW_ADHERENCE', `adherencia ${a.avgAdherence === null ? '—' : round(a.avgAdherence)}/100`),
        ],
        null,
        WEEKLY_REVIEW_DAYS,
      );
    }
    return mk(
      'KEEP_PLAN',
      'CALORIES',
      onTrackConfidence(a),
      'Vas progresando a buen ritmo. Mantén las calorías actuales.',
      [ev('ON_TRACK', a.weightTrend !== null ? `${fmtKg(a.weightTrend)} kg/sem` : 'progresando')],
      null,
      WEEKLY_REVIEW_DAYS,
    );
  }

  if (a.goal === 'gain') {
    if (a.fastGain) {
      return mk(
        'REDUCE_CALORIES',
        'CALORIES',
        'MEDIUM',
        `Estás subiendo rápido (${fmtKg(a.weightTrend)} kg/sem), lo que añade grasa de más. Bajar ${Math.abs(GAIN_TRIM_KCAL)} kcal (a ${target + GAIN_TRIM_KCAL}) mantiene una ganancia más limpia.`,
        [ev('FAST_GAIN', `${fmtKg(a.weightTrend)} kg/sem`)],
        { calorieDelta: GAIN_TRIM_KCAL, newCalorieTarget: target + GAIN_TRIM_KCAL },
        CALORIE_REVIEW_DAYS,
      );
    }
    if (a.stalledStreak >= STALL_WEEKS_FOR_CHANGE) {
      if (a.highAdherence) {
        return mk(
          'INCREASE_CALORIES',
          'CALORIES',
          a.stalledStreak >= STALL_WEEKS_HIGH_CONF ? 'HIGH' : 'MEDIUM',
          `Tu ganancia lleva ${a.stalledStreak} semanas detenida con buena adherencia. Subir ${SAFETY_BUMP_KCAL} kcal (a ${target + SAFETY_BUMP_KCAL}) reactiva el progreso.`,
          [ev('GAIN_STALLED', `${a.stalledStreak} semanas sin ganancia`), ev('HIGH_ADHERENCE', `adherencia ${round(a.avgAdherence)}/100`)],
          { calorieDelta: SAFETY_BUMP_KCAL, newCalorieTarget: target + SAFETY_BUMP_KCAL },
          CALORIE_REVIEW_DAYS,
        );
      }
      return mk(
        'KEEP_PLAN',
        'CALORIES',
        'MEDIUM',
        'Tu ganancia está detenida, pero primero necesitas más consistencia antes de subir calorías. Mantén el plan y mejora la adherencia.',
        [ev('GAIN_STALLED', `${a.stalledStreak} semanas`), ev('LOW_ADHERENCE', `adherencia ${a.avgAdherence === null ? '—' : round(a.avgAdherence)}/100`)],
        null,
        WEEKLY_REVIEW_DAYS,
      );
    }
    return mk(
      'KEEP_PLAN',
      'CALORIES',
      onTrackConfidence(a),
      'Tu ganancia avanza. Mantén las calorías actuales.',
      [ev('ON_TRACK', a.weightTrend !== null ? `${fmtKg(a.weightTrend)} kg/sem` : 'progresando')],
      null,
      WEEKLY_REVIEW_DAYS,
    );
  }

  // maintain
  return mk(
    'KEEP_PLAN',
    'CALORIES',
    onTrackConfidence(a),
    'Tu objetivo es mantenimiento y tu peso se sostiene. Mantén las calorías actuales.',
    [ev('ON_TRACK', 'mantenimiento')],
    null,
    WEEKLY_REVIEW_DAYS,
  );
}

function decideProtein(a: Analysis, ctx: CoachingContext, calories: PlanDecision): PlanDecision {
  const target = ctx.targets.proteinG;

  // An adherent user who still can't get near a high protein target for weeks -> the
  // target is likely impractical. Lowering it protects overall adherence.
  if (a.highAdherence && a.proteinWellBelowStreak >= 3) {
    const newTarget = target - PROTEIN_BUMP_G;
    return mk(
      'REDUCE_PROTEIN',
      'PROTEIN',
      'MEDIUM',
      `Vienes cumpliendo el plan pero tu proteína quedó muy por debajo de la meta ${a.proteinWellBelowStreak} semanas seguidas. Bajar la meta a ${newTarget}g la hace alcanzable sin castigar tu adherencia.`,
      [ev('PROTEIN_TARGET_UNREACHABLE', `${a.proteinWellBelowStreak} semanas por debajo del 60% de ${target}g`), ev('HIGH_ADHERENCE', `adherencia ${round(a.avgAdherence)}/100`)],
      { proteinDelta: -PROTEIN_BUMP_G, newProteinTarget: newTarget },
      CALORIE_REVIEW_DAYS,
    );
  }

  // Deepening a deficit calls for MORE protein to preserve muscle — when there's room.
  const proteinNotHigh = a.recentAvgProtein === null || a.recentAvgProtein <= target * 1.05;
  if (calories.code === 'REDUCE_CALORIES' && ctx.user.goal === 'lose' && proteinNotHigh) {
    const newTarget = target + PROTEIN_BUMP_G;
    return mk(
      'INCREASE_PROTEIN',
      'PROTEIN',
      'MEDIUM',
      `Al bajar calorías, subir la proteína a ${newTarget}g protege tu masa muscular en el déficit más profundo.`,
      [ev('DEFICIT_DEEPENING', `recorte de ${Math.abs(PLATEAU_CUT_KCAL)} kcal`), ev('PROTEIN_HAS_ROOM', a.recentAvgProtein === null ? 'proteína no elevada' : `promedio ${round(a.recentAvgProtein)}g vs meta ${target}g`)],
      { proteinDelta: PROTEIN_BUMP_G, newProteinTarget: newTarget },
      CALORIE_REVIEW_DAYS,
    );
  }

  return mk(
    'MAINTAIN_PROTEIN',
    'PROTEIN',
    'MEDIUM',
    `Mantén tu meta de proteína en ${target}g; es la correcta para tu objetivo.`,
    [ev('PROTEIN_TARGET_OK', `meta ${target}g`)],
    null,
    WEEKLY_REVIEW_DAYS,
  );
}

function decideIntervention(ctx: CoachingContext): PlanDecision | null {
  const review = ctx.review;
  if (!review) return null;

  const persistingIntervened = review.followUp.persisting.find((i) => i.intervention === 'INTERVENED');
  if (persistingIntervened && persistingIntervened.weeksActive >= 2) {
    return mk(
      'REPLACE_INTERVENTION',
      'INTERVENTION',
      persistingIntervened.weeksActive >= 3 ? 'HIGH' : 'MEDIUM',
      `"${persistingIntervened.issue}" sigue presente ${persistingIntervened.weeksActive} semanas pese a que cumpliste el compromiso: el enfoque actual no funciona para ti. Cambia de intervención.`,
      [ev('INTERVENTION_FAILED', `${persistingIntervened.issue} persiste ${persistingIntervened.weeksActive} semanas pese a intervención`)],
      null,
      CALORIE_REVIEW_DAYS,
    );
  }

  const persisting = review.followUp.persisting[0];
  if (persisting) {
    return mk(
      'CONTINUE_INTERVENTION',
      'INTERVENTION',
      'MEDIUM',
      `"${persisting.issue}" sigue abierto; dale más tiempo a la intervención actual y vuelve a evaluar la próxima semana.`,
      [ev('ISSUE_PERSISTING', `${persisting.issue} (${persisting.weeksActive} semana(s), intervención=${persisting.intervention})`)],
      null,
      WEEKLY_REVIEW_DAYS,
    );
  }

  return null; // nothing to intervene on
}

// ── assembly + helpers ──

function assemble(
  ctx: CoachingContext,
  a: Analysis,
  posture: PlanPosture,
  headline: PlanDecision,
  decisions: PlanDecision[],
): NutritionPlan {
  return {
    meta: {
      planner: PLANNER_NAME,
      version: PLANNER_VERSION,
      contractVersion: ctx.meta.version,
      weeksAnalyzed: a.weeksAnalyzed,
      generatedAt: ctx.meta.generatedAt,
    },
    posture,
    headline,
    decisions,
    reviewWindowDays: headline.reviewWindowDays,
  };
}

function isChange(code: PlanDecisionCode): boolean {
  return (
    code === 'REDUCE_CALORIES' ||
    code === 'INCREASE_CALORIES' ||
    code === 'REPLACE_INTERVENTION' ||
    code === 'INCREASE_PROTEIN' ||
    code === 'REDUCE_PROTEIN'
  );
}

function headlineRank(code: PlanDecisionCode): number {
  const order: PlanDecisionCode[] = [
    'REDUCE_CALORIES',
    'INCREASE_CALORIES',
    'REPLACE_INTERVENTION',
    'REDUCE_PROTEIN',
    'INCREASE_PROTEIN',
  ];
  const i = order.indexOf(code);
  return i === -1 ? order.length : i;
}

function onTrackConfidence(a: Analysis): PlanConfidence {
  if (a.weeksAnalyzed >= 3 && a.highAdherence) return 'HIGH';
  if (a.weeksAnalyzed >= 2) return 'MEDIUM';
  return 'LOW';
}

function mk(
  code: PlanDecisionCode,
  dimension: PlanDimension,
  confidence: PlanConfidence,
  explanation: string,
  evidence: PlanEvidence[],
  adjustment: PlanDecision['adjustment'],
  reviewWindowDays: number,
): PlanDecision {
  return { code, dimension, confidence, explanation, evidence, adjustment, reviewWindowDays };
}

function ev(code: string, detail: string): PlanEvidence {
  return { code, detail };
}

function countLeading<T>(xs: T[], pred: (x: T) => boolean): number {
  let n = 0;
  for (const x of xs) {
    if (pred(x)) n++;
    else break;
  }
  return n;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round(x: number | null): number | string {
  return x === null ? '—' : Math.round(x);
}

function fmtKg(x: number | null): string {
  return x === null ? '—' : String(Math.round(x * 100) / 100);
}
