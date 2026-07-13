import { Injectable } from '@nestjs/common';
import { BehaviorFlag, GoalType, PlateauStatus, UserNutritionState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeWeightTrend } from '../common/metrics/weight-trend';
import { IntelligenceSnapshot } from './types/intelligence-snapshot';

/** Bump to invalidate every cached state on its next read (no migration needed). */
export const CURRENT_STATE_VERSION = 3; // 2B.1: log-derived streaks (logging/protein/calorie)
const STATE_TTL_MS = 12 * 60 * 60 * 1000; // 12h freshness window
const WEIGHT_WINDOW_DAYS = 30;
const MIN_WEIGHT_POINTS = 3; // mirror progress-analyst's gate before classifying a trend

// ── Phase 2A.2 derived-state thresholds (deterministic, tunable in one place) ──
const PROTEIN_LOW_RATIO = 0.7; // avg protein under 70% of target = chronic low
const WEEKEND_OVEREAT_RATIO = 1.15; // weekend cals >15% over weekdays
const BREAKFAST_MIN_RATE = 0.3; // breakfast on <30% of logged days = skipped
const LOW_CONSISTENCY_MAX_DAYS = 4; // < 4 logged days in 7 = inconsistent
const PLATEAU_ADHERENCE_MIN = 70; // "high adherence" gate for a real plateau

// ── Phase 2B.1 streak thresholds — a day "counts" toward each streak when: ──
const PROTEIN_STREAK_MIN_RATIO = 0.9; // protein within 10% of target counts as hit
const CAL_STREAK_LOW_RATIO = 0.8; // calories within [0.8x .. 1.1x] of target = on-target day
const CAL_STREAK_HIGH_RATIO = 1.1;

@Injectable()
export class NutritionStateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fresh longitudinal state, recomputed lazily if missing / stale / expired / outdated. */
  async get(userId: string): Promise<UserNutritionState> {
    const existing = await this.prisma.userNutritionState.findUnique({ where: { userId } });
    if (existing && this.isFresh(existing)) return existing;
    return this.recompute(userId);
  }

  private isFresh(s: UserNutritionState): boolean {
    return (
      !s.stale &&
      s.version === CURRENT_STATE_VERSION &&
      Date.now() - s.computedAt.getTime() < STATE_TTL_MS
    );
  }

  /**
   * Cheap flag flip. Event listeners call this on meal.logged / weight.updated.
   * updateMany → no-op (does not throw) when the row doesn't exist yet.
   */
  async markStale(userId: string): Promise<void> {
    await this.prisma.userNutritionState.updateMany({ where: { userId }, data: { stale: true } });
  }

  /**
   * Compact, read-only projection for the mobile intelligence surface. Reads the
   * rollup (lazily fresh via get()) + the latest recommendation. Pure projection
   * — no metric is recomputed here. This is what the UI renders.
   */
  async getIntelligenceSnapshot(userId: string): Promise<IntelligenceSnapshot> {
    const now = new Date();
    const [state, topRec] = await Promise.all([
      this.get(userId),
      // The "what to do now" action: the newest still-actionable item — an untouched
      // nudge OR a live commitment (so a pledged action keeps showing as the focus).
      this.prisma.recommendation.findFirst({
        where: {
          userId,
          OR: [
            { status: 'PENDING' },
            { status: 'COMMITTED', commitExpiresAt: { gt: now } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, reason: true, messageForUser: true, type: true, priority: true, status: true },
      }),
    ]);

    return {
      computedAt: state.computedAt.toISOString(),
      scores: { adherence: state.adherenceScore, nutrition: state.nutritionScore },
      trendStatus: state.trendStatus,
      plateauStatus: state.plateauStatus,
      behaviorFlags: state.behaviorFlags,
      weekly: {
        daysLogged7d: state.daysLogged7d,
        avgCalories7d: state.avgCalories7d,
        avgCalories30d: state.avgCalories30d,
        calorieTarget: state.calorieTarget,
        weightTrendKgWk: state.weightTrendKgWk,
        loggingStreak: state.loggingStreak,
        proteinStreakDays: state.proteinStreakDays,
        calorieStreakDays: state.calorieStreakDays,
      },
      topRecommendation: topRec
        ? {
            id: topRec.id,
            reason: topRec.reason,
            message: topRec.messageForUser,
            type: topRec.type,
            priority: topRec.priority,
            status: topRec.status,
          }
        : null,
    };
  }

  /**
   * Deterministic rollup — pure function of logs/weights/goal. No AI, no side
   * effects beyond the upsert. Safe to run concurrently (idempotent).
   */
  async recompute(userId: string): Promise<UserNutritionState> {
    const now = new Date();
    const day7 = startOfDay(daysAgo(now, 7));
    const day30 = startOfDay(daysAgo(now, WEIGHT_WINDOW_DAYS));

    const [goal, logs30, weights] = await Promise.all([
      this.prisma.goal.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { type: true, targetCalories: true, proteinG: true },
      }),
      this.prisma.dailyLog.findMany({
        where: { userId, date: { gte: day30 } },
        select: {
          date: true,
          caloriesLogged: true,
          proteinG: true,
          planFollowed: true,
          adherencePct: true,
          loggedMeals: { select: { mealType: true } },
        },
        orderBy: { date: 'desc' },
      }),
      this.prisma.weightLog.findMany({
        where: { userId, date: { gte: day30 } },
        select: { date: true, weightKg: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const logged30 = logs30.filter((l) => l.caloriesLogged > 0);
    const logged7 = logged30.filter((l) => l.date >= day7);
    const last7All = logs30.filter((l) => l.date >= day7);

    const avgCalories7d = round1(avg(logged7.map((l) => l.caloriesLogged)));
    const avgCalories30d = round1(avg(logged30.map((l) => l.caloriesLogged)));
    const avgProtein7d = round1(avg(logged7.map((l) => l.proteinG)));
    const adherencePct7d = computeAdherence(last7All);

    const totalMeals7 = logged7.reduce((acc, l) => acc + l.loggedMeals.length, 0);
    const avgMealsPerDay = logged7.length
      ? Math.round((totalMeals7 / logged7.length) * 10) / 10
      : null;

    const trend = computeWeightTrend(
      weights.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    );
    const trendStatus = classifyTrend(goal?.type ?? null, trend.weeklyRateKg, trend.points);

    // ── Phase 2A.2 derived state — computed HERE and nowhere else ──
    const calorieTarget = goal?.targetCalories ?? null;
    const proteinTarget = goal?.proteinG ?? null;

    // ── Phase 2B.1: consistency streaks, derived from logs (single source of truth).
    // Self-healing — a gap or a deleted log shortens the streak on the next recompute,
    // unlike the old event-counter that could freeze on inactivity.
    const loggingStreak = streakEndingToday(logged30, () => true);
    const proteinStreakDays =
      proteinTarget && proteinTarget > 0
        ? streakEndingToday(logged30, (l) => l.proteinG >= proteinTarget * PROTEIN_STREAK_MIN_RATIO)
        : 0;
    const calorieStreakDays =
      calorieTarget && calorieTarget > 0
        ? streakEndingToday(
            logged30,
            (l) =>
              l.caloriesLogged >= calorieTarget * CAL_STREAK_LOW_RATIO &&
              l.caloriesLogged <= calorieTarget * CAL_STREAK_HIGH_RATIO,
          )
        : 0;

    const adherenceScore = computeAdherenceScore({
      daysLogged7d: logged7.length,
      loggingStreak,
      adherencePct7d,
    });
    const nutritionScore = computeNutritionScore({
      avgCalories7d,
      avgProtein7d,
      calorieTarget,
      proteinTarget,
    });
    const behaviorFlags = detectBehaviorFlags({
      daysLogged7d: logged7.length,
      daysLogged30d: logged30.length,
      avgProtein7d,
      proteinTarget,
      weekendAvgCal: avg(logged30.filter((l) => isWeekend(l.date)).map((l) => l.caloriesLogged)),
      weekdayAvgCal: avg(logged30.filter((l) => !isWeekend(l.date)).map((l) => l.caloriesLogged)),
      weekendDays: logged30.filter((l) => isWeekend(l.date)).length,
      weekdayDays: logged30.filter((l) => !isWeekend(l.date)).length,
      breakfastRate: logged7.length
        ? logged7.filter((l) => l.loggedMeals.some((m) => m.mealType === 'BREAKFAST')).length /
          logged7.length
        : null,
    });
    const plateauStatus = classifyPlateau({
      goalType: goal?.type ?? null,
      trendStatus,
      adherenceScore,
      weightDataPoints: trend.points,
    });

    const data = {
      goalType: goal?.type ?? null,
      calorieTarget,
      proteinTargetG: proteinTarget,
      avgCalories7d,
      avgCalories30d,
      avgProtein7d,
      adherencePct7d,
      loggingStreak,
      proteinStreakDays,
      calorieStreakDays,
      daysLogged7d: logged7.length,
      daysLogged30d: logged30.length,
      avgMealsPerDay,
      currentWeightKg: trend.currentKg,
      weightTrendKgWk: trend.weeklyRateKg,
      weightDataPoints: trend.points,
      trendStatus,
      adherenceScore,
      nutritionScore,
      plateauStatus,
      behaviorFlags,
      stale: false,
      version: CURRENT_STATE_VERSION,
      computedAt: now,
    };

    return this.prisma.userNutritionState.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}

// ── pure helpers ──

function daysAgo(from: Date, n: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Phase 2B.1 — consecutive-day streak ending today, with a one-day grace so a
 * not-yet-logged today does not break the streak (we anchor on yesterday instead).
 * Counts only logged days that satisfy `qualifies`. Keyed by UTC date so it matches
 * @db.Date columns exactly regardless of server timezone. Deterministic, self-healing:
 * a gap or a deleted log simply shortens the streak on the next recompute.
 */
function streakEndingToday<T extends { date: Date }>(
  loggedDays: T[],
  qualifies: (day: T) => boolean,
): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const keys = new Set<string>();
  for (const d of loggedDays) {
    if (qualifies(d)) keys.add(d.date.toISOString().slice(0, 10));
  }
  if (keys.size === 0) return 0;

  const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const today = new Date();
  let cursor = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (!keys.has(keyOf(cursor))) {
    cursor -= MS_PER_DAY; // grace day
    if (!keys.has(keyOf(cursor))) return 0;
  }
  let count = 0;
  while (keys.has(keyOf(cursor))) {
    count++;
    cursor -= MS_PER_DAY;
  }
  return count;
}

function round1(x: number | null): number | null {
  return x === null ? null : Math.round(x * 10) / 10;
}

/** 0..100 over days that have been evaluated (mirrors the legacy context-builder logic). */
function computeAdherence(
  logs: Array<{ adherencePct: number | null; planFollowed: boolean | null }>,
): number | null {
  const evaluated = logs.filter((l) => l.planFollowed !== null);
  if (evaluated.length === 0) return null;
  const sum = evaluated.reduce((acc, l) => {
    if (l.adherencePct !== null) return acc + l.adherencePct * 100;
    return acc + (l.planFollowed ? 100 : 0);
  }, 0);
  return Math.round(sum / evaluated.length);
}

function isWeekend(d: Date): boolean {
  const day = d.getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

/** 0..100 behavioral consistency: showing up (logging + streak + plan adherence). */
function computeAdherenceScore(p: {
  daysLogged7d: number;
  loggingStreak: number;
  adherencePct7d: number | null;
}): number | null {
  if (p.daysLogged7d === 0) return null;
  const loggingFreq = Math.min(1, p.daysLogged7d / 7);
  const streakNorm = Math.min(1, p.loggingStreak / 7);
  const planAdh = (p.adherencePct7d ?? loggingFreq * 100) / 100; // fall back to frequency if unevaluated
  const score = 0.5 * loggingFreq + 0.2 * streakNorm + 0.3 * planAdh;
  return Math.round(score * 100);
}

/** 0..100 intake quality: how close the window's intake was to the goal targets. */
function computeNutritionScore(p: {
  avgCalories7d: number | null;
  avgProtein7d: number | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
}): number | null {
  if (p.avgCalories7d === null || !p.calorieTarget || p.calorieTarget <= 0) return null;
  const calProximity = Math.max(
    0,
    1 - Math.abs(p.avgCalories7d - p.calorieTarget) / p.calorieTarget,
  );
  let proteinAdequacy = 1;
  if (p.proteinTarget && p.proteinTarget > 0 && p.avgProtein7d !== null) {
    proteinAdequacy = Math.min(1, p.avgProtein7d / p.proteinTarget);
  }
  const score = 0.5 * calProximity + 0.5 * proteinAdequacy;
  return Math.round(score * 100);
}

/** Deterministic habit detection — typed flags, no free-form strings. */
function detectBehaviorFlags(p: {
  daysLogged7d: number;
  daysLogged30d: number;
  avgProtein7d: number | null;
  proteinTarget: number | null;
  weekendAvgCal: number | null;
  weekdayAvgCal: number | null;
  weekendDays: number;
  weekdayDays: number;
  breakfastRate: number | null;
}): BehaviorFlag[] {
  const flags: BehaviorFlag[] = [];

  if (
    p.daysLogged7d >= 3 &&
    p.avgProtein7d !== null &&
    p.proteinTarget &&
    p.avgProtein7d < p.proteinTarget * PROTEIN_LOW_RATIO
  ) {
    flags.push(BehaviorFlag.PROTEIN_CHRONIC_LOW);
  }

  if (p.daysLogged30d >= 3 && p.daysLogged7d < LOW_CONSISTENCY_MAX_DAYS) {
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
    p.daysLogged7d >= LOW_CONSISTENCY_MAX_DAYS &&
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
  if (
    p.goalType === 'LOSE_FAT' &&
    p.trendStatus === 'stalled' &&
    p.adherenceScore >= PLATEAU_ADHERENCE_MIN
  ) {
    return PlateauStatus.PLATEAU_SUSPECTED;
  }
  return PlateauStatus.NONE;
}

/** Goal-aware interpretation of the raw weekly rate. */
function classifyTrend(
  goalType: GoalType | null,
  weeklyRateKg: number | null,
  points: number,
): string {
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
