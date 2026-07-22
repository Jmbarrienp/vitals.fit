import { BehaviorFlag, GoalType, PlateauStatus } from '@prisma/client';
import { computeWeightTrend } from '../common/metrics/weight-trend';

/**
 * The single, window-agnostic derivation of nutrition intelligence. Both the
 * PRESENT rollup (`NutritionStateService.recompute`, anchor = now) and the
 * HISTORICAL ledger (`WeeklyLedgerService`, anchor = week end) call `deriveState`
 * with a different anchor + windows — so scores, flags, plateau and streaks are
 * computed in exactly ONE place. No consumer re-implements this math.
 *
 * Pure and deterministic: same inputs -> same output, no I/O, no clock reads
 * except through the explicit `anchor`.
 */

// ── derived-state thresholds (deterministic, tunable in one place) ──
export const MIN_WEIGHT_POINTS = 3; // mirror progress-analyst's gate before classifying a trend
const PROTEIN_LOW_RATIO = 0.7; // avg protein under 70% of target = chronic low
const WEEKEND_OVEREAT_RATIO = 1.15; // weekend cals >15% over weekdays
const BREAKFAST_MIN_RATE = 0.3; // breakfast on <30% of logged days = skipped
const LOW_CONSISTENCY_MAX_DAYS = 4; // < 4 logged days in the short window = inconsistent
const PLATEAU_ADHERENCE_MIN = 70; // "high adherence" gate for a real plateau
const PROTEIN_STREAK_MIN_RATIO = 0.9; // protein within 10% of target counts as hit
const CAL_STREAK_LOW_RATIO = 0.8; // calories within [0.8x .. 1.1x] of target = on-target day
const CAL_STREAK_HIGH_RATIO = 1.1;

export interface DeriveDayLog {
  date: Date;
  caloriesLogged: number;
  proteinG: number;
  planFollowed: boolean | null;
  adherencePct: number | null;
  loggedMeals: { mealType: string }[];
}

export interface DeriveWeightPoint {
  date: Date;
  weightKg: number;
}

export interface DeriveInput {
  goalType: GoalType | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
  /** All DailyLog rows in the SHORT window (rolling 7d for the present, or the calendar week). */
  windowShortAll: DeriveDayLog[];
  /** All DailyLog rows in the 30d window ending at `anchor` — the streak/trend/weekend context. */
  window30All: DeriveDayLog[];
  /** Weight logs within the 30d window ending at `anchor`. */
  weights30: DeriveWeightPoint[];
  /** Streaks and trend are evaluated as of this instant (now, or a week's last day). */
  anchor: Date;
  /** true for the present (a not-yet-logged today doesn't break a streak); false for a closed week. */
  streakGrace: boolean;
}

export interface DerivedState {
  avgCaloriesShort: number | null;
  avgCalories30d: number | null;
  avgProteinShort: number | null;
  adherencePctShort: number | null;
  avgMealsPerDay: number | null;
  daysLoggedShort: number;
  daysLogged30d: number;
  loggingStreak: number;
  proteinStreakDays: number;
  calorieStreakDays: number;
  currentWeightKg: number | null;
  weightTrendKgWk: number | null;
  weightDataPoints: number;
  trendStatus: string;
  adherenceScore: number | null;
  nutritionScore: number | null;
  plateauStatus: PlateauStatus;
  behaviorFlags: BehaviorFlag[];
}

export function deriveState(i: DeriveInput): DerivedState {
  const loggedShort = i.windowShortAll.filter((l) => l.caloriesLogged > 0);
  const logged30 = i.window30All.filter((l) => l.caloriesLogged > 0);

  const avgCaloriesShort = round1(avg(loggedShort.map((l) => l.caloriesLogged)));
  const avgCalories30d = round1(avg(logged30.map((l) => l.caloriesLogged)));
  const avgProteinShort = round1(avg(loggedShort.map((l) => l.proteinG)));
  const adherencePctShort = computeAdherence(i.windowShortAll);

  const totalMealsShort = loggedShort.reduce((acc, l) => acc + l.loggedMeals.length, 0);
  const avgMealsPerDay = loggedShort.length ? Math.round((totalMealsShort / loggedShort.length) * 10) / 10 : null;

  const trend = computeWeightTrend(i.weights30.map((w) => ({ date: w.date, weightKg: w.weightKg })));
  const trendStatus = classifyTrend(i.goalType, trend.weeklyRateKg, trend.points);

  const calorieTarget = i.calorieTarget;
  const proteinTarget = i.proteinTarget;

  const loggingStreak = streakEndingAt(logged30, () => true, i.anchor, i.streakGrace);
  const proteinStreakDays =
    proteinTarget && proteinTarget > 0
      ? streakEndingAt(logged30, (l) => l.proteinG >= proteinTarget * PROTEIN_STREAK_MIN_RATIO, i.anchor, i.streakGrace)
      : 0;
  const calorieStreakDays =
    calorieTarget && calorieTarget > 0
      ? streakEndingAt(
          logged30,
          (l) =>
            l.caloriesLogged >= calorieTarget * CAL_STREAK_LOW_RATIO &&
            l.caloriesLogged <= calorieTarget * CAL_STREAK_HIGH_RATIO,
          i.anchor,
          i.streakGrace,
        )
      : 0;

  const adherenceScore = computeAdherenceScore({
    daysLoggedShort: loggedShort.length,
    loggingStreak,
    adherencePctShort,
  });
  const nutritionScore = computeNutritionScore({
    avgCaloriesShort,
    avgProteinShort,
    calorieTarget,
    proteinTarget,
  });
  const behaviorFlags = detectBehaviorFlags({
    daysLoggedShort: loggedShort.length,
    daysLogged30d: logged30.length,
    avgProteinShort,
    proteinTarget,
    weekendAvgCal: avg(logged30.filter((l) => isWeekend(l.date)).map((l) => l.caloriesLogged)),
    weekdayAvgCal: avg(logged30.filter((l) => !isWeekend(l.date)).map((l) => l.caloriesLogged)),
    weekendDays: logged30.filter((l) => isWeekend(l.date)).length,
    weekdayDays: logged30.filter((l) => !isWeekend(l.date)).length,
    breakfastRate: loggedShort.length
      ? loggedShort.filter((l) => l.loggedMeals.some((m) => m.mealType === 'BREAKFAST')).length / loggedShort.length
      : null,
  });
  const plateauStatus = classifyPlateau({
    goalType: i.goalType,
    trendStatus,
    adherenceScore,
    weightDataPoints: trend.points,
  });

  return {
    avgCaloriesShort,
    avgCalories30d,
    avgProteinShort,
    adherencePctShort,
    avgMealsPerDay,
    daysLoggedShort: loggedShort.length,
    daysLogged30d: logged30.length,
    loggingStreak,
    proteinStreakDays,
    calorieStreakDays,
    currentWeightKg: trend.currentKg,
    weightTrendKgWk: trend.weeklyRateKg,
    weightDataPoints: trend.points,
    trendStatus,
    adherenceScore,
    nutritionScore,
    plateauStatus,
    behaviorFlags,
  };
}

// ── pure helpers (moved here from the service so the present and the ledger share one copy) ──

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function round1(x: number | null): number | null {
  return x === null ? null : Math.round(x * 10) / 10;
}

function isWeekend(d: Date): boolean {
  // Preserves the rollup's original local-day semantics (server runs in UTC in prod,
  // so this equals UTC there); kept identical to avoid changing present-state output.
  const day = d.getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

/**
 * Consecutive-day streak ending at `anchor` (its UTC day). With `grace`, an
 * anchor day that isn't logged doesn't break the streak (we step back one day) —
 * used for the present, where "today" may not be logged yet. A closed week uses
 * grace=false: the streak is whatever was alive on the week's last day. Keyed by
 * UTC date so it matches @db.Date columns exactly regardless of server timezone.
 */
export function streakEndingAt<T extends { date: Date }>(
  loggedDays: T[],
  qualifies: (day: T) => boolean,
  anchor: Date,
  grace: boolean,
): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const keys = new Set<string>();
  for (const d of loggedDays) {
    if (qualifies(d)) keys.add(d.date.toISOString().slice(0, 10));
  }
  if (keys.size === 0) return 0;

  const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  let cursor = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  if (!keys.has(keyOf(cursor))) {
    if (!grace) return 0;
    cursor -= MS_PER_DAY;
    if (!keys.has(keyOf(cursor))) return 0;
  }
  let count = 0;
  while (keys.has(keyOf(cursor))) {
    count++;
    cursor -= MS_PER_DAY;
  }
  return count;
}

/** 0..100 over days that have been evaluated (mirrors the legacy context-builder logic). */
function computeAdherence(logs: Array<{ adherencePct: number | null; planFollowed: boolean | null }>): number | null {
  const evaluated = logs.filter((l) => l.planFollowed !== null);
  if (evaluated.length === 0) return null;
  const sum = evaluated.reduce((acc, l) => {
    if (l.adherencePct !== null) return acc + l.adherencePct * 100;
    return acc + (l.planFollowed ? 100 : 0);
  }, 0);
  return Math.round(sum / evaluated.length);
}

/** 0..100 behavioral consistency: showing up (logging + streak + plan adherence). */
function computeAdherenceScore(p: {
  daysLoggedShort: number;
  loggingStreak: number;
  adherencePctShort: number | null;
}): number | null {
  if (p.daysLoggedShort === 0) return null;
  const loggingFreq = Math.min(1, p.daysLoggedShort / 7);
  const streakNorm = Math.min(1, p.loggingStreak / 7);
  const planAdh = (p.adherencePctShort ?? loggingFreq * 100) / 100; // fall back to frequency if unevaluated
  const score = 0.5 * loggingFreq + 0.2 * streakNorm + 0.3 * planAdh;
  return Math.round(score * 100);
}

/** 0..100 intake quality: how close the window's intake was to the goal targets. */
function computeNutritionScore(p: {
  avgCaloriesShort: number | null;
  avgProteinShort: number | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
}): number | null {
  if (p.avgCaloriesShort === null || !p.calorieTarget || p.calorieTarget <= 0) return null;
  const calProximity = Math.max(0, 1 - Math.abs(p.avgCaloriesShort - p.calorieTarget) / p.calorieTarget);
  let proteinAdequacy = 1;
  if (p.proteinTarget && p.proteinTarget > 0 && p.avgProteinShort !== null) {
    proteinAdequacy = Math.min(1, p.avgProteinShort / p.proteinTarget);
  }
  const score = 0.5 * calProximity + 0.5 * proteinAdequacy;
  return Math.round(score * 100);
}

/** Deterministic habit detection — typed flags, no free-form strings. */
function detectBehaviorFlags(p: {
  daysLoggedShort: number;
  daysLogged30d: number;
  avgProteinShort: number | null;
  proteinTarget: number | null;
  weekendAvgCal: number | null;
  weekdayAvgCal: number | null;
  weekendDays: number;
  weekdayDays: number;
  breakfastRate: number | null;
}): BehaviorFlag[] {
  const flags: BehaviorFlag[] = [];

  if (
    p.daysLoggedShort >= 3 &&
    p.avgProteinShort !== null &&
    p.proteinTarget &&
    p.avgProteinShort < p.proteinTarget * PROTEIN_LOW_RATIO
  ) {
    flags.push(BehaviorFlag.PROTEIN_CHRONIC_LOW);
  }

  if (p.daysLogged30d >= 3 && p.daysLoggedShort < LOW_CONSISTENCY_MAX_DAYS) {
    flags.push(BehaviorFlag.LOW_LOGGING_CONSISTENCY);
  }

  if (
    p.weekendDays >= 2 &&
    p.weekdayDays >= 2 &&
    p.weekendAvgCal !== null &&
    p.weekdayAvgCal !== null &&
    p.weekendAvgCal > p.weekdayAvgCal * WEEKEND_OVEREAT_RATIO
  ) {
    flags.push(BehaviorFlag.WEEKEND_OVEREATING);
  }

  if (
    p.daysLoggedShort >= LOW_CONSISTENCY_MAX_DAYS &&
    p.breakfastRate !== null &&
    p.breakfastRate < BREAKFAST_MIN_RATE
  ) {
    flags.push(BehaviorFlag.BREAKFAST_SKIPPED);
  }

  return flags;
}

/** A real plateau = weight-loss goal + flat trend + the user is actually adhering. */
function classifyPlateau(p: {
  goalType: GoalType | null;
  trendStatus: string;
  adherenceScore: number | null;
  weightDataPoints: number;
}): PlateauStatus {
  if (p.weightDataPoints < MIN_WEIGHT_POINTS || p.adherenceScore === null) {
    return PlateauStatus.INSUFFICIENT_DATA;
  }
  if (p.goalType === 'LOSE_FAT' && p.trendStatus === 'stalled' && p.adherenceScore >= PLATEAU_ADHERENCE_MIN) {
    return PlateauStatus.PLATEAU_SUSPECTED;
  }
  return PlateauStatus.NONE;
}

/** Goal-aware interpretation of the raw weekly rate. */
function classifyTrend(goalType: GoalType | null, weeklyRateKg: number | null, points: number): string {
  if (weeklyRateKg === null || points < MIN_WEIGHT_POINTS) return 'insufficient_data';
  const FLAT = 0.1;
  const dir = goalDirection(goalType);
  if (dir === 'maintain') return Math.abs(weeklyRateKg) < 0.2 ? 'on_track' : 'stalled';
  if (dir === 'lose') {
    if (weeklyRateKg <= -FLAT) return 'on_track';
    if (weeklyRateKg >= FLAT) return 'regressing';
    return 'stalled';
  }
  // gain
  if (weeklyRateKg >= FLAT) return 'on_track';
  if (weeklyRateKg <= -FLAT) return 'regressing';
  return 'stalled';
}

function goalDirection(goalType: GoalType | null): 'lose' | 'gain' | 'maintain' {
  if (goalType === 'LOSE_FAT') return 'lose';
  if (goalType === 'GAIN_MUSCLE') return 'gain';
  return 'maintain'; // MAINTAIN | RECOMPOSITION | HEALTH_WELLNESS | null
}
