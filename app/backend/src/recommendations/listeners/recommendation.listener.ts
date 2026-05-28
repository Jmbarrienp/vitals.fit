import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Priority, RecommendationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpoPushService } from '../../push/services/expo-push.service';
import { RecommendationService } from '../services/recommendation.service';
import { MealLoggedEvent } from '../../orchestrator/events/meal.event';

const COOLDOWN_MS = 30 * 60 * 1000; // 30 min between recommendations per user

@Injectable()
export class RecommendationListener {
  private readonly logger = new Logger(RecommendationListener.name);
  private readonly lastRun = new Map<string, number>();

  constructor(
    private readonly recommendation: RecommendationService,
    private readonly prisma: PrismaService,
    private readonly expoPush: ExpoPushService,
  ) {}

  @OnEvent('meal.logged', { async: true, promisify: true })
  async handleMealLogged(event: MealLoggedEvent): Promise<void> {
    const last = this.lastRun.get(event.userId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      this.logger.log(`[meal.logged] cooldown active for ${event.userId} — skipping`);
      return;
    }
    this.lastRun.set(event.userId, Date.now());
    this.logger.log(`[meal.logged] userId=${event.userId} mealId=${event.mealId}`);

    const text = await this.recommendation.generateForUser(event.userId, 'meal.logged');

    await this.prisma.recommendation.create({
      data: {
        userId: event.userId,
        type: RecommendationType.BEHAVIOR_RECOMMENDATION,
        priority: Priority.MEDIUM,
        trigger: 'meal.logged',
        messageForUser: text,
      },
    });

    // Fire-and-forget — nunca bloquea el handler
    this.expoPush.sendToUser(event.userId, 'Vitals Fit', text, 'meal.logged');

    this.logger.log(`[meal.logged] recomendación generada: ${text.slice(0, 80)}`);
  }
}
