import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { NutritionStateService } from '../../nutrition-state/nutrition-state.service';
import {
  decidePlanAdjustment,
  stateToInput,
} from '../../recommendations/services/recommendation-engine';
import { WeightUpdatedEvent } from '../events/progress.event';

const PLAN_CHANGE_COOLDOWN_DAYS = 14;

@Injectable()
export class RecommendationHandler {
  private readonly logger = new Logger(RecommendationHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionState: NutritionStateService,
  ) {}

  @OnEvent('weight.updated')
  async handle(event: WeightUpdatedEvent) {
    this.logger.log(`[recommendation-engine] evaluating after weight update for ${event.userId}`);

    // Single source of truth: read the rollup, never recompute the trend here.
    const [state, goal] = await Promise.all([
      this.nutritionState.get(event.userId),
      this.prisma.goal.findFirst({ where: { userId: event.userId, isActive: true } }),
    ]);
    if (!goal) return;

    // Plan-change cooldown (14 days) — unchanged infrastructure.
    const lastHistory = await this.prisma.planHistory.findFirst({
      where: { userId: event.userId },
      orderBy: { activeFrom: 'desc' },
    });
    if (lastHistory) {
      const daysSince = Math.floor(
        (Date.now() - lastHistory.activeFrom.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSince < PLAN_CHANGE_COOLDOWN_DAYS) {
        this.logger.log(
          `[recommendation-engine] cooldown active — ${daysSince}/${PLAN_CHANGE_COOLDOWN_DAYS} days`,
        );
        return;
      }
    }

    const input = stateToInput({
      goal: goal.type,
      state,
      today: { caloriesLogged: 0, proteinG: 0, mealsLogged: 0 }, // not used by plan channel
    });
    const decided = decidePlanAdjustment(input);

    if (!decided) {
      this.logger.log(
        `[recommendation-engine] no plan change (plateau=${state.plateauStatus} trend=${state.trendStatus})`,
      );
      return;
    }

    await this.prisma.recommendation.create({
      data: {
        userId: event.userId,
        type: decided.type,
        priority: decided.priority,
        trigger: 'weight.updated',
        reason: decided.reason,
        messageForUser: decided.message,
        planChange: decided.calorieAdjustment !== undefined,
        calorieAdjustment: decided.calorieAdjustment ?? null,
        requiresConfirmation: decided.requiresConfirmation,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    this.logger.log(
      `[recommendation-engine] created ${decided.reason} (${decided.calorieAdjustment ?? 0} kcal)`,
    );
  }
}
