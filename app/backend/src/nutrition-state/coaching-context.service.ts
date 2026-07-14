import { Injectable } from '@nestjs/common';
import { BehaviorFlag, GoalType, PersonaType, PlateauStatus, Sex } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionStateService } from './nutrition-state.service';
import { WeeklyLedgerService } from './weekly-ledger.service';
import { WeeklyReviewService } from './weekly-review.service';
import { WeeklyLedgerEntry } from './types/weekly-ledger';
import { ReviewSnapshot } from './types/weekly-review';
import {
  COACHING_CONTRACT_NAME,
  COACHING_CONTRACT_VERSION,
  CoachingContext,
  ContextDepth,
  CtxBehaviorFlag,
  CtxGoal,
  CtxPersona,
  CtxPlateau,
  CtxReview,
  CtxSex,
  CtxTrend,
  CtxWeek,
} from './types/coaching-context';

/** History weeks included at depth 'full' — enough narrative, bounded payload. */
const HISTORY_WEEKS = 8;

// ── Internal -> contract vocabulary maps. THE only place this translation exists.
// If the schema gains a value, TypeScript forces an explicit decision here instead
// of silently leaking a new word to every model consumer.
const GOAL_MAP: Record<GoalType, CtxGoal> = {
  LOSE_FAT: 'lose',
  GAIN_MUSCLE: 'gain',
  MAINTAIN: 'maintain',
  RECOMPOSITION: 'maintain',
  HEALTH_WELLNESS: 'maintain',
};
const PERSONA_MAP: Record<PersonaType, CtxPersona> = {
  PRINCIPIANTE_MOTIVADO: 'beginner',
  ATLETA_AMATEUR: 'athlete',
  OCUPADO_CONSISTENTE: 'busy',
  REINCIDENTE: 'returning',
  EXPERTO_AUTODIRIGIDO: 'expert',
};
const SEX_MAP: Record<Sex, CtxSex> = { MALE: 'male', FEMALE: 'female', OTHER: 'other' };
const PLATEAU_MAP: Record<PlateauStatus, CtxPlateau> = {
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  NONE: 'NONE',
  PLATEAU_SUSPECTED: 'PLATEAU_SUSPECTED',
};
const FLAG_MAP: Record<BehaviorFlag, CtxBehaviorFlag> = {
  PROTEIN_CHRONIC_LOW: 'PROTEIN_CHRONIC_LOW',
  LOW_LOGGING_CONSISTENCY: 'LOW_LOGGING_CONSISTENCY',
  WEEKEND_OVEREATING: 'WEEKEND_OVEREATING',
  BREAKFAST_SKIPPED: 'BREAKFAST_SKIPPED',
};
const TREND_VALUES: CtxTrend[] = ['on_track', 'stalled', 'regressing', 'insufficient_data'];

/**
 * Builds the CoachingContext — the single, versioned, model-agnostic snapshot any
 * LLM consumes (Phase 2C.0). A pure COMPOSER over the existing projections:
 * rollup (present), weekly ledger (history), weekly review (follow-up), and the
 * commitment lifecycle. It computes no metric and reads no raw meal history; the
 * only raw read is TODAY's log (today-state, not history).
 *
 * depth 'today'  -> user/targets/today/currentState/commitments (daily nudges).
 * depth 'full'   -> everything, including ledger history + review (weekly coach).
 */
@Injectable()
export class CoachingContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: NutritionStateService,
    private readonly ledger: WeeklyLedgerService,
    private readonly review: WeeklyReviewService,
  ) {}

  async build(userId: string, depth: ContextDepth = 'full'): Promise<CoachingContext> {
    const today = startOfDay(new Date());
    const now = new Date();

    const [profile, goal, todayLog, rollup, commitments] = await Promise.all([
      this.prisma.userProfile.findUnique({ where: { userId }, select: { persona: true, sex: true } }),
      this.prisma.goal.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { type: true, targetCalories: true, proteinG: true, carbsG: true, fatG: true, tdee: true },
      }),
      this.prisma.dailyLog.findUnique({
        where: { userId_date: { userId, date: today } },
        select: {
          caloriesLogged: true,
          proteinG: true,
          carbsG: true,
          fatG: true,
          loggedMeals: {
            select: { name: true, totalCalories: true, mealType: true },
            orderBy: { loggedAt: 'desc' },
            take: 3,
          },
        },
      }),
      this.state.get(userId),
      this.prisma.recommendation.findMany({
        where: { userId, status: 'COMMITTED', commitExpiresAt: { gt: now } },
        select: { reason: true, messageForUser: true, commitExpiresAt: true },
        orderBy: { committedAt: 'desc' },
      }),
    ]);

    // History + review are fetched SEQUENTIALLY (not in the batch above): both would
    // otherwise trigger the ledger's lazy backfill concurrently and race on the
    // (userId, weekStart) unique key. The review backfills first; getHistory then
    // reads the already-fresh ledger.
    const reviewSnap: ReviewSnapshot | null = depth === 'full' ? await this.review.getReviewSnapshot(userId) : null;
    const history: WeeklyLedgerEntry[] = depth === 'full' ? await this.ledger.getHistory(userId, HISTORY_WEEKS) : [];

    return {
      meta: {
        contract: COACHING_CONTRACT_NAME,
        version: COACHING_CONTRACT_VERSION,
        depth,
        generatedAt: now.toISOString(),
        locale: 'es',
      },
      user: {
        goal: GOAL_MAP[goal?.type ?? 'MAINTAIN'],
        persona: PERSONA_MAP[profile?.persona ?? 'PRINCIPIANTE_MOTIVADO'],
        sex: SEX_MAP[profile?.sex ?? 'OTHER'],
      },
      targets: {
        tdee: Math.round(goal?.tdee ?? 2000),
        calories: goal?.targetCalories ?? 2000,
        proteinG: goal?.proteinG ?? 150,
        carbsG: goal?.carbsG ?? 200,
        fatG: goal?.fatG ?? 65,
      },
      today: {
        caloriesLogged: todayLog?.caloriesLogged ?? 0,
        proteinG: todayLog?.proteinG ?? 0,
        carbsG: todayLog?.carbsG ?? 0,
        fatG: todayLog?.fatG ?? 0,
        mealsLogged: todayLog?.loggedMeals.length ?? 0,
        recentMeals: (todayLog?.loggedMeals ?? []).map((m) => ({
          name: m.name ?? 'Comida',
          calories: m.totalCalories,
          mealType: m.mealType.toLowerCase(),
        })),
      },
      currentState: {
        computedAt: rollup.computedAt.toISOString(),
        adherenceScore: rollup.adherenceScore,
        nutritionScore: rollup.nutritionScore,
        trendStatus: toTrend(rollup.trendStatus),
        plateauStatus: PLATEAU_MAP[rollup.plateauStatus],
        behaviorFlags: rollup.behaviorFlags.map((f) => FLAG_MAP[f]),
        adherencePct7d: rollup.adherencePct7d,
        daysLogged7d: rollup.daysLogged7d,
        avgCalories7d: rollup.avgCalories7d,
        streaks: {
          loggingDays: rollup.loggingStreak,
          proteinDays: rollup.proteinStreakDays,
          calorieDays: rollup.calorieStreakDays,
        },
        weight: {
          currentKg: rollup.currentWeightKg,
          trendKgPerWeek: rollup.weightTrendKgWk,
          dataPoints: rollup.weightDataPoints,
        },
      },
      history: { weeks: history.map(toCtxWeek) },
      review: toCtxReview(reviewSnap),
      commitments: {
        active: commitments.map((c) => ({
          reason: c.reason,
          message: c.messageForUser,
          expiresAt: c.commitExpiresAt!.toISOString().slice(0, 10),
        })),
      },
    };
  }
}

// ── pure projections (ledger/review -> contract) ──

function toCtxWeek(w: WeeklyLedgerEntry): CtxWeek {
  return {
    weekStart: w.weekStart,
    adherenceScore: w.adherenceScore,
    nutritionScore: w.nutritionScore,
    trendStatus: toTrend(w.trendStatus),
    plateauStatus: PLATEAU_MAP[w.plateauStatus],
    behaviorFlags: w.behaviorFlags.map((f) => FLAG_MAP[f]),
    daysLogged: w.daysLogged,
    avgCalories: w.avgCalories,
    avgProtein: w.avgProtein,
    commitmentsCompleted: w.completedCommitments,
    commitmentsExpired: w.expiredCommitments,
    primaryIssue: w.primaryIssue,
    primaryImprovement: w.primaryImprovement,
  };
}

function toCtxReview(snap: ReviewSnapshot | null): CtxReview | null {
  if (!snap || !snap.hasReview || !snap.current) return null;
  const r = snap.current;
  return {
    weekStart: r.weekStart,
    improvedMetrics: r.improved.map((m) => m.metric),
    worsenedMetrics: r.worsened.map((m) => m.metric),
    biggestOpportunity: r.biggestOpportunity,
    biggestImprovement: r.biggestImprovement,
    commitmentOutcomes: r.commitments.outcomes.map((o) => ({ reason: o.reason, status: o.status })),
    followUp: {
      resolved: snap.followUp.resolved.map(toCtxIssue),
      persisting: snap.followUp.persisting.map(toCtxIssue),
      emerged: snap.followUp.emerged.map(toCtxIssue),
    },
    nextPriority: r.nextPriority,
  };
}

function toCtxIssue(i: { issue: string; weeksActive: number; intervention: 'INTERVENED' | 'IGNORED' | 'NONE' }) {
  return { issue: i.issue, weeksActive: i.weeksActive, intervention: i.intervention };
}

function toTrend(status: string | null): CtxTrend | null {
  return TREND_VALUES.includes(status as CtxTrend) ? (status as CtxTrend) : null;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
