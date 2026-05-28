import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { WeightUpdatedEvent } from '../events/progress.event';

@Injectable()
export class RecommendationHandler {
  private readonly logger = new Logger(RecommendationHandler.name);

  constructor(private prisma: PrismaService) {}

  @OnEvent('weight.updated')
  async handle(event: WeightUpdatedEvent) {
    this.logger.log(`[recommendation-engine] evaluating after weight update for ${event.userId}`);

    const logs = await this.prisma.weightLog.findMany({
      where: { userId: event.userId },
      orderBy: { date: 'asc' },
      take: 14,
    });

    if (logs.length < 7) {
      this.logger.log(`[recommendation-engine] needs 7+ logs, has ${logs.length} — skipping`);
      return;
    }

    const goal = await this.prisma.goal.findFirst({
      where: { userId: event.userId, isActive: true },
    });
    if (!goal) return;

    // Check last adjustment cooldown (14 days)
    const lastHistory = await this.prisma.planHistory.findFirst({
      where: { userId: event.userId },
      orderBy: { activeFrom: 'desc' },
    });
    if (lastHistory) {
      const daysSince = Math.floor(
        (Date.now() - lastHistory.activeFrom.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSince < 14) {
        this.logger.log(`[recommendation-engine] cooldown active — ${daysSince}/14 days`);
        return;
      }
    }

    // Calculate weekly rate
    const first = logs[0].weightKg;
    const last = logs[logs.length - 1].weightKg;
    const days = Math.max(1, logs.length - 1);
    const weeklyRate = ((last - first) / days) * 7;

    let message: string | null = null;
    let adjustment = 0;

    if (goal.type === 'LOSE_FAT' && weeklyRate > -0.1) {
      adjustment = -200;
      message = `Tu peso lleva estable ${logs.length} días. El recommendation-engine sugiere reducir ${Math.abs(adjustment)} kcal para retomar el progreso.`;
    } else if (goal.type === 'LOSE_FAT' && weeklyRate < -0.9) {
      adjustment = 100;
      message = `Estás perdiendo peso más rápido de lo recomendado. El recommendation-engine sugiere aumentar ${adjustment} kcal para proteger músculo.`;
    } else if (goal.type === 'GAIN_MUSCLE' && weeklyRate < 0.1) {
      adjustment = 100;
      message = `Sin progreso de ganancia en ${logs.length} días. El recommendation-engine sugiere aumentar ${adjustment} kcal.`;
    }

    if (message) {
      await this.prisma.recommendation.create({
        data: {
          userId: event.userId,
          type: 'PLAN_ADJUSTMENT',
          priority: 'HIGH',
          trigger: 'weight.updated → recommendation-engine',
          messageForUser: message,
          planChange: true,
          calorieAdjustment: adjustment,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      this.logger.log(`[recommendation-engine] created recommendation: ${adjustment} kcal`);
    } else {
      this.logger.log(`[recommendation-engine] on_track — no adjustment needed`);
    }
  }
}
