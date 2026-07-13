import { Injectable } from '@nestjs/common';
import { BehaviorFlag, GoalType, Prisma, WeeklyNutritionSnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addDaysUTC, isoWeekStartUTC, isoYearWeek } from '../common/metrics/iso-week';
import { FLAG_TO_REASON } from '../recommendations/recommendation-reason';
import { deriveState, DeriveDayLog, DerivedState } from './derive';
import { WeeklyImprovement, WeeklyLedgerEntry } from './types/weekly-ledger';

/** Formula version that produced a snapshot — lets future consumers trust field semantics. */
const SNAPSHOT_VERSION = 1;
/** Never backfill further than this on a first read (bounds a dormant user's cold read). */
const MAX_BACKFILL_WEEKS = 52;
/** deriveState needs 30d of context before each week's end. */
const CONTEXT_DAYS = 30;

type LedgerLog = DeriveDayLog;
type LedgerWeight = { date: Date; weightKg: number };
type LedgerRec = {
  createdAt: Date;
  respondedAt: Date | null;
  completedAt: Date | null;
  commitExpiresAt: Date | null;
  status: string;
};
type LedgerGoal = { type: GoalType; targetCalories: number; proteinG: number } | null;

/**
 * The Weekly Behavioral Ledger (Phase 2B.2). Append-only historical memory: one
 * immutable row per COMPLETED ISO week. The ONLY component that reads raw logs to
 * build history — everyone else (Weekly/Monthly Review, Claude Coach, timelines,
 * analytics) consumes these aggregates. Derived metrics come from the shared
 * deriveState() (anchor = week end), so there is no second copy of the scoring math.
 *
 * Built lazily on read (no cron — Render Free), the same discipline as the rollup.
 */
@Injectable()
export class WeeklyLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ledger history, newest-first, appending any newly-completed weeks first. */
  async getHistory(userId: string, limit = 26): Promise<WeeklyLedgerEntry[]> {
    await this.ensureBackfilled(userId);
    const rows = await this.prisma.weeklyNutritionSnapshot.findMany({
      where: { userId },
      orderBy: { weekStart: 'desc' },
      take: limit,
    });
    return rows.map(toEntry);
  }

  /**
   * Append a snapshot for every COMPLETED ISO week from the user's first activity
   * through last week that isn't already recorded. Append-only + idempotent:
   * existing weeks are never mutated, and the in-progress week is never written
   * (its data is still changing, so it can't be immutable history yet).
   *
   * Returns the number of weeks appended.
   */
  async ensureBackfilled(userId: string): Promise<number> {
    const now = new Date();
    const currentWeekStart = isoWeekStartUTC(now);
    const lastCompletedWeek = addDaysUTC(currentWeekStart, -7); // the week before the current one

    const [firstLog, firstWeight, existing] = await Promise.all([
      this.prisma.dailyLog.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } }),
      this.prisma.weightLog.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } }),
      this.prisma.weeklyNutritionSnapshot.findMany({ where: { userId }, select: { weekStart: true } }),
    ]);

    const firstActivity = earliest(firstLog?.date ?? null, firstWeight?.date ?? null);
    if (!firstActivity) return 0; // nothing to record yet

    let firstWeek = isoWeekStartUTC(firstActivity);
    const cap = addDaysUTC(currentWeekStart, -7 * MAX_BACKFILL_WEEKS);
    if (firstWeek.getTime() < cap.getTime()) firstWeek = cap;
    if (lastCompletedWeek.getTime() < firstWeek.getTime()) return 0; // no completed week yet

    const have = new Set(existing.map((e) => dayKey(e.weekStart)));
    const missing: Date[] = [];
    for (let w = firstWeek; w.getTime() <= lastCompletedWeek.getTime(); w = addDaysUTC(w, 7)) {
      if (!have.has(dayKey(w))) missing.push(w);
    }
    if (missing.length === 0) return 0;

    // Pull everything the span needs ONCE, then slice per week in memory. Recommendations
    // reach back 14d before the span so a commitment can expire/complete inside it.
    const spanStart = addDaysUTC(missing[0], -CONTEXT_DAYS);
    const spanEndExcl = addDaysUTC(lastCompletedWeek, 7);
    const [goal, logs, weights, recs] = await Promise.all([
      this.prisma.goal.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { type: true, targetCalories: true, proteinG: true },
      }),
      this.prisma.dailyLog.findMany({
        where: { userId, date: { gte: spanStart, lt: spanEndExcl } },
        select: { date: true, caloriesLogged: true, proteinG: true, planFollowed: true, adherencePct: true, loggedMeals: { select: { mealType: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.weightLog.findMany({
        where: { userId, date: { gte: spanStart, lt: spanEndExcl } },
        select: { date: true, weightKg: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.recommendation.findMany({
        where: { userId, createdAt: { gte: addDaysUTC(spanStart, -14), lt: spanEndExcl } },
        select: { createdAt: true, respondedAt: true, completedAt: true, commitExpiresAt: true, status: true },
      }),
    ]);

    // Append ascending so each week's primaryImprovement can read the prior week.
    let prev = await this.prisma.weeklyNutritionSnapshot.findFirst({
      where: { userId, weekStart: { lt: missing[0] } },
      orderBy: { weekStart: 'desc' },
    });
    let appended = 0;
    for (const weekStart of missing) {
      const data = buildWeek(userId, weekStart, goal as LedgerGoal, logs as LedgerLog[], weights, recs, prev);
      // unique(userId, weekStart) + empty update = idempotent and never-mutating,
      // even under a concurrent writer.
      const row = await this.prisma.weeklyNutritionSnapshot.upsert({
        where: { userId_weekStart: { userId, weekStart } },
        create: data,
        update: {},
      });
      prev = row;
      appended++;
    }
    return appended;
  }
}

// ── pure builders ──

function buildWeek(
  userId: string,
  weekStart: Date,
  goal: LedgerGoal,
  logs: LedgerLog[],
  weights: LedgerWeight[],
  recs: LedgerRec[],
  prev: WeeklyNutritionSnapshot | null,
): Prisma.WeeklyNutritionSnapshotUncheckedCreateInput {
  const weekEndExcl = addDaysUTC(weekStart, 7); // exclusive
  const weekLastDay = addDaysUTC(weekStart, 6); // Sunday — streak/trend anchor
  const ctxStart = addDaysUTC(weekEndExcl, -CONTEXT_DAYS);

  const windowShortAll = logs.filter((l) => inRange(l.date, weekStart, weekEndExcl));
  const window30All = logs.filter((l) => inRange(l.date, ctxStart, weekEndExcl));
  const weights30 = weights.filter((w) => inRange(w.date, ctxStart, weekEndExcl));

  const d = deriveState({
    goalType: goal?.type ?? null,
    calorieTarget: goal?.targetCalories ?? null,
    proteinTarget: goal?.proteinG ?? null,
    windowShortAll,
    window30All,
    weights30,
    anchor: weekLastDay,
    streakGrace: false, // a closed week has no "today" grace
  });

  // Behavior / commitment aggregates for THIS week, by deterministic timestamps.
  const inWeek = (dt: Date | null | undefined) => !!dt && inRange(dt, weekStart, weekEndExcl);
  const generated = recs.filter((r) => inWeek(r.createdAt)).length;
  const accepted = recs.filter((r) => r.status === 'ACCEPTED' && inWeek(r.respondedAt)).length;
  const completed = recs.filter((r) => inWeek(r.completedAt)).length;
  const expired = recs.filter(
    (r) => inWeek(r.commitExpiresAt) && (!r.completedAt || r.completedAt.getTime() > r.commitExpiresAt!.getTime()),
  ).length;
  const terminal = completed + expired;
  const completionRate = terminal > 0 ? Math.round((completed / terminal) * 100) / 100 : null;

  const { isoYear, isoWeek } = isoYearWeek(weekStart);

  return {
    userId,
    weekStart,
    isoYear,
    isoWeek,
    snapshotVersion: SNAPSHOT_VERSION,
    goalType: goal?.type ?? null,
    calorieTarget: goal?.targetCalories ?? null,
    proteinTargetG: goal?.proteinG ?? null,
    adherenceScore: d.adherenceScore,
    nutritionScore: d.nutritionScore,
    trendStatus: d.trendStatus,
    plateauStatus: d.plateauStatus,
    behaviorFlags: d.behaviorFlags,
    avgCalories: d.avgCaloriesShort,
    avgProtein: d.avgProteinShort,
    adherencePct: d.adherencePctShort,
    daysLogged: d.daysLoggedShort,
    loggingStreak: d.loggingStreak,
    proteinStreakDays: d.proteinStreakDays,
    calorieStreakDays: d.calorieStreakDays,
    currentWeightKg: d.currentWeightKg,
    weightTrendKgWk: d.weightTrendKgWk,
    weightDataPoints: d.weightDataPoints,
    generatedRecommendations: generated,
    acceptedRecommendations: accepted,
    completedCommitments: completed,
    expiredCommitments: expired,
    completionRate,
    primaryIssue: pickPrimaryIssue(d),
    primaryImprovement: prev ? pickPrimaryImprovement(d, prev) : null,
  };
}

/** The week's single dominant problem, as a structured RecommendationReason code. */
function pickPrimaryIssue(d: DerivedState): string | null {
  if (d.plateauStatus === 'PLATEAU_SUSPECTED') return 'PLATEAU_SUSPECTED';
  const order: BehaviorFlag[] = [
    'PROTEIN_CHRONIC_LOW',
    'WEEKEND_OVEREATING',
    'LOW_LOGGING_CONSISTENCY',
    'BREAKFAST_SKIPPED',
  ];
  for (const flag of order) {
    if (d.behaviorFlags.includes(flag)) return FLAG_TO_REASON[flag];
  }
  if (d.adherenceScore !== null && d.adherenceScore < 40) return 'LOW_ADHERENCE_WEEK';
  return null;
}

/** The biggest meaningful positive delta vs the prior recorded week. */
function pickPrimaryImprovement(d: DerivedState, prev: WeeklyNutritionSnapshot): WeeklyImprovement | null {
  const candidates: { code: WeeklyImprovement; delta: number; min: number }[] = [
    { code: 'ADHERENCE_IMPROVED', delta: (d.adherenceScore ?? 0) - (prev.adherenceScore ?? 0), min: 5 },
    { code: 'NUTRITION_IMPROVED', delta: (d.nutritionScore ?? 0) - (prev.nutritionScore ?? 0), min: 5 },
    { code: 'LOGGING_STREAK_IMPROVED', delta: d.loggingStreak - prev.loggingStreak, min: 2 },
    { code: 'PROTEIN_STREAK_IMPROVED', delta: d.proteinStreakDays - prev.proteinStreakDays, min: 2 },
  ];
  const passing = candidates.filter((c) => c.delta >= c.min);
  if (passing.length === 0) return null;
  passing.sort((a, b) => b.delta / b.min - a.delta / a.min); // biggest improvement relative to its threshold
  return passing[0].code;
}

// ── small utils ──

function toEntry(r: WeeklyNutritionSnapshot): WeeklyLedgerEntry {
  return {
    weekStart: dayKey(r.weekStart),
    isoYear: r.isoYear,
    isoWeek: r.isoWeek,
    goalType: r.goalType,
    calorieTarget: r.calorieTarget,
    proteinTargetG: r.proteinTargetG,
    adherenceScore: r.adherenceScore,
    nutritionScore: r.nutritionScore,
    trendStatus: r.trendStatus,
    plateauStatus: r.plateauStatus,
    behaviorFlags: r.behaviorFlags,
    avgCalories: r.avgCalories,
    avgProtein: r.avgProtein,
    adherencePct: r.adherencePct,
    daysLogged: r.daysLogged,
    loggingStreak: r.loggingStreak,
    proteinStreakDays: r.proteinStreakDays,
    calorieStreakDays: r.calorieStreakDays,
    currentWeightKg: r.currentWeightKg,
    weightTrendKgWk: r.weightTrendKgWk,
    weightDataPoints: r.weightDataPoints,
    generatedRecommendations: r.generatedRecommendations,
    acceptedRecommendations: r.acceptedRecommendations,
    completedCommitments: r.completedCommitments,
    expiredCommitments: r.expiredCommitments,
    completionRate: r.completionRate,
    primaryIssue: r.primaryIssue,
    primaryImprovement: r.primaryImprovement as WeeklyImprovement | null,
  };
}

/** [start, endExcl) membership by UTC day. */
function inRange(d: Date, start: Date, endExcl: Date): boolean {
  const t = d.getTime();
  return t >= start.getTime() && t < endExcl.getTime();
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}
