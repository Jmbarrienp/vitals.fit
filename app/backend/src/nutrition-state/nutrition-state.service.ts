import { Injectable } from '@nestjs/common';
import { UserNutritionState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveState, DeriveDayLog } from './derive';
import { IntelligenceSnapshot } from './types/intelligence-snapshot';

/** Bump to invalidate every cached state on its next read (no migration needed). */
export const CURRENT_STATE_VERSION = 3; // 2B.1: log-derived streaks (logging/protein/calorie)
const STATE_TTL_MS = 12 * 60 * 60 * 1000; // 12h freshness window
const WEIGHT_WINDOW_DAYS = 30;

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
    return !s.stale && s.version === CURRENT_STATE_VERSION && Date.now() - s.computedAt.getTime() < STATE_TTL_MS;
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
          OR: [{ status: 'PENDING' }, { status: 'COMMITTED', commitExpiresAt: { gt: now } }],
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

    // Present state = deriveState anchored at NOW over rolling windows. The exact
    // same function builds each historical week in the ledger — one derivation, two
    // callers. windowShortAll (rolling 7d) mirrors the old last7All.
    const windowShortAll = logs30.filter((l) => l.date >= day7);
    const d = deriveState({
      goalType: goal?.type ?? null,
      calorieTarget: goal?.targetCalories ?? null,
      proteinTarget: goal?.proteinG ?? null,
      windowShortAll,
      window30All: logs30 as DeriveDayLog[],
      weights30: weights,
      anchor: now,
      streakGrace: true,
    });

    const data = {
      goalType: goal?.type ?? null,
      calorieTarget: goal?.targetCalories ?? null,
      proteinTargetG: goal?.proteinG ?? null,
      avgCalories7d: d.avgCaloriesShort,
      avgCalories30d: d.avgCalories30d,
      avgProtein7d: d.avgProteinShort,
      adherencePct7d: d.adherencePctShort,
      loggingStreak: d.loggingStreak,
      proteinStreakDays: d.proteinStreakDays,
      calorieStreakDays: d.calorieStreakDays,
      daysLogged7d: d.daysLoggedShort,
      daysLogged30d: d.daysLogged30d,
      avgMealsPerDay: d.avgMealsPerDay,
      currentWeightKg: d.currentWeightKg,
      weightTrendKgWk: d.weightTrendKgWk,
      weightDataPoints: d.weightDataPoints,
      trendStatus: d.trendStatus,
      adherenceScore: d.adherenceScore,
      nutritionScore: d.nutritionScore,
      plateauStatus: d.plateauStatus,
      behaviorFlags: d.behaviorFlags,
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

// ── window-boundary helpers (present-state rolling windows; local = UTC in prod) ──

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
