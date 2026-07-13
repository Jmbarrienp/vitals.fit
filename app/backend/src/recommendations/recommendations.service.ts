import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionStateService } from '../nutrition-state/nutrition-state.service';
import { decideNudge, decidePlanAdjustment, stateToInput } from './services/recommendation-engine';

/** Phase 2B.1: how long a committed recommendation stays actionable before it lapses. */
const COMMITMENT_WINDOW_DAYS = 7;

@Injectable()
export class RecommendationsService {
  constructor(
    private prisma: PrismaService,
    private nutritionState: NutritionStateService,
  ) {}

  /**
   * On-demand recommendation. Reads the rollup (single source of truth) — it no
   * longer recomputes weight trend or adherence — and returns ONE highest-impact
   * recommendation: a plan change if the weight data warrants it, else the day's
   * nudge. Persists the structured reason for downstream insights.
   */
  async generate(userId: string) {
    const goal = await this.prisma.goal.findFirst({ where: { userId, isActive: true } });
    if (!goal) return { message: 'Crea un objetivo primero', recommendations: [] };

    const today = startOfDay(new Date());
    const [state, todayLog] = await Promise.all([
      this.nutritionState.get(userId),
      this.prisma.dailyLog.findUnique({
        where: { userId_date: { userId, date: today } },
        select: {
          caloriesLogged: true,
          proteinG: true,
          _count: { select: { loggedMeals: true } },
        },
      }),
    ]);

    const input = stateToInput({
      goal: goal.type,
      state,
      today: {
        caloriesLogged: todayLog?.caloriesLogged ?? 0,
        proteinG: todayLog?.proteinG ?? 0,
        mealsLogged: todayLog?._count.loggedMeals ?? 0,
      },
    });

    // One strong recommendation over five weak ones: plan change wins, else nudge.
    const decided = decidePlanAdjustment(input) ?? decideNudge(input);

    const saved = await this.prisma.recommendation.create({
      data: {
        userId,
        type: decided.type,
        priority: decided.priority,
        trigger: 'recommendations.generate',
        reason: decided.reason,
        messageForUser: decided.message,
        planChange: decided.calorieAdjustment !== undefined,
        calorieAdjustment: decided.calorieAdjustment ?? null,
        requiresConfirmation: decided.requiresConfirmation,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      generated: 1,
      recommendations: [{ ...saved, summary: decided.message }],
    };
  }

  async getActive(userId: string) {
    await this.sweepExpiredCommitments(userId);
    // "Active" now includes live commitments, not just untouched pending nudges.
    return this.prisma.recommendation.findMany({
      where: { userId, status: { in: ['PENDING', 'COMMITTED'] } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getHistory(userId: string) {
    await this.sweepExpiredCommitments(userId);
    return this.prisma.recommendation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        type: true,
        priority: true,
        trigger: true,
        reason: true,
        messageForUser: true,
        status: true,
        planChange: true,
        calorieAdjustment: true,
        committedAt: true,
        commitExpiresAt: true,
        completedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Phase 2B.1 — a recommendation becomes an explicit commitment (accountability).
   * Only an untouched PENDING recommendation can be committed; the act starts a
   * fixed window after which it lapses (swept lazily on read, no cron).
   */
  async commit(userId: string, id: string) {
    const rec = await this.prisma.recommendation.findFirst({ where: { id, userId } });
    if (!rec) return { message: 'Recomendación no encontrada' };
    if (rec.status !== 'PENDING') {
      return { message: 'Esta recomendación ya no se puede comprometer', status: rec.status };
    }
    const now = new Date();
    return this.prisma.recommendation.update({
      where: { id },
      data: {
        status: 'COMMITTED',
        committedAt: now,
        commitExpiresAt: new Date(now.getTime() + COMMITMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }

  /**
   * Phase 2B.1 — the user marks a live commitment as done. Closing the loop is
   * what turns intelligence into behavior; completion rate is read off these rows.
   */
  async complete(userId: string, id: string) {
    const rec = await this.prisma.recommendation.findFirst({ where: { id, userId } });
    if (!rec) return { message: 'Recomendación no encontrada' };
    if (rec.status !== 'COMMITTED') {
      return { message: 'Solo puedes completar un compromiso activo', status: rec.status };
    }
    if (rec.commitExpiresAt && rec.commitExpiresAt.getTime() < Date.now()) {
      // Lapsed before completion — record the truth, don't pretend it was done.
      await this.prisma.recommendation.update({ where: { id }, data: { status: 'EXPIRED' } });
      return { message: 'El compromiso venció', status: 'EXPIRED' };
    }
    return this.prisma.recommendation.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  /** Lazy lifecycle: live commitments past their window become EXPIRED on the next read. */
  private async sweepExpiredCommitments(userId: string): Promise<void> {
    await this.prisma.recommendation.updateMany({
      where: { userId, status: 'COMMITTED', commitExpiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  async respond(userId: string, id: string, action: string) {
    const rec = await this.prisma.recommendation.findFirst({
      where: { id, userId },
    });
    if (!rec) return { message: 'Recomendación no encontrada' };

    // If accepted and has calorie adjustment → apply it
    if (action === 'ACCEPTED' && rec.calorieAdjustment) {
      const goal = await this.prisma.goal.findFirst({ where: { userId, isActive: true } });
      if (goal) {
        const newCalories = goal.targetCalories + rec.calorieAdjustment;
        await this.prisma.goal.update({
          where: { id: goal.id },
          data: { targetCalories: Math.max(1200, newCalories) },
        });
      }
    }

    return this.prisma.recommendation.update({
      where: { id },
      data: {
        status: action === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
        respondedAt: new Date(),
        userResponse: action,
      },
    });
  }
}

function startOfDay(date: Date): Date {
  date.setHours(0, 0, 0, 0);
  return date;
}
