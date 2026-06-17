import { Injectable } from '@nestjs/common';
import { GoalType, UserNutritionState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeWeightTrend } from '../common/metrics/weight-trend';

/** Bump to invalidate every cached state on its next read (no migration needed). */
export const CURRENT_STATE_VERSION = 1;
const STATE_TTL_MS = 12 * 60 * 60 * 1000; // 12h freshness window
const WEIGHT_WINDOW_DAYS = 30;
const MIN_WEIGHT_POINTS = 3; // mirror progress-analyst's gate before classifying a trend

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
   * Deterministic rollup — pure function of logs/weights/goal. No AI, no side
   * effects beyond the upsert. Safe to run concurrently (idempotent).
   */
  async recompute(userId: string): Promise<UserNutritionState> {
    const now = new Date();
    const day7 = startOfDay(daysAgo(now, 7));
    const day30 = startOfDay(daysAgo(now, WEIGHT_WINDOW_DAYS));

    const [goal, habits, logs30, weights] = await Promise.all([
      this.prisma.goal.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { type: true, targetCalories: true, proteinG: true },
      }),
      this.prisma.userHabits.findUnique({
        where: { userId },
        select: { currentStreak: true },
      }),
      this.prisma.dailyLog.findMany({
        where: { userId, date: { gte: day30 } },
        select: {
          date: true,
          caloriesLogged: true,
          proteinG: true,
          planFollowed: true,
          adherencePct: true,
          _count: { select: { loggedMeals: true } },
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

    const totalMeals7 = logged7.reduce((acc, l) => acc + l._count.loggedMeals, 0);
    const avgMealsPerDay = logged7.length
      ? Math.round((totalMeals7 / logged7.length) * 10) / 10
      : null;

    const trend = computeWeightTrend(
      weights.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    );
    const trendStatus = classifyTrend(goal?.type ?? null, trend.weeklyRateKg, trend.points);

    const data = {
      goalType: goal?.type ?? null,
      calorieTarget: goal?.targetCalories ?? null,
      proteinTargetG: goal?.proteinG ?? null,
      avgCalories7d,
      avgCalories30d,
      avgProtein7d,
      adherencePct7d,
      loggingStreak: habits?.currentStreak ?? 0,
      daysLogged7d: logged7.length,
      daysLogged30d: logged30.length,
      avgMealsPerDay,
      currentWeightKg: trend.currentKg,
      weightTrendKgWk: trend.weeklyRateKg,
      weightDataPoints: trend.points,
      trendStatus,
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
