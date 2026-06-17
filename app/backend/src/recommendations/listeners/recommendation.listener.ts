import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpoPushService } from '../../push/services/expo-push.service';
import { RecommendationService } from '../services/recommendation.service';
import { MealLoggedEvent } from '../../orchestrator/events/meal.event';

// DB-backed: survives server restarts (Render redeploys reset in-memory state)
const COOLDOWN_HOURS = 4;
const DEDUPE_PREFIX_LEN = 35;

@Injectable()
export class RecommendationListener {
  private readonly logger = new Logger(RecommendationListener.name);

  constructor(
    private readonly recommendation: RecommendationService,
    private readonly prisma: PrismaService,
    private readonly expoPush: ExpoPushService,
  ) {}

  @OnEvent('meal.logged', { async: true, promisify: true })
  async handleMealLogged(event: MealLoggedEvent): Promise<void> {
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);

    // DB-backed cooldown: any recommendation sent in the last 4h skips this one
    const recentRec = await this.prisma.recommendation.findFirst({
      where: { userId: event.userId, createdAt: { gte: cooldownCutoff } },
      select: { createdAt: true },
    });

    if (recentRec) {
      this.logger.log(`[meal.logged] cooldown active for ${event.userId} — skipping`);
      return;
    }

    this.logger.log(`[meal.logged] userId=${event.userId} mealId=${event.mealId}`);

    const rec = await this.recommendation.generateForUser(event.userId, 'meal.logged');
    const text = rec.text;

    // Message dedupe: skip if the same message prefix was sent in the last 24h
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const duplicate = await this.prisma.recommendation.findFirst({
      where: {
        userId: event.userId,
        createdAt: { gte: dayAgo },
        messageForUser: { startsWith: text.slice(0, DEDUPE_PREFIX_LEN) },
      },
      select: { id: true },
    });

    if (duplicate) {
      this.logger.log(`[meal.logged] duplicate message for ${event.userId} — skipping push`);
      return;
    }

    await this.prisma.recommendation.create({
      data: {
        userId: event.userId,
        type: rec.type,
        priority: rec.priority,
        trigger: 'meal.logged',
        reason: rec.reason,
        messageForUser: text,
      },
    });

    // Fire-and-forget — nunca bloquea el handler
    this.expoPush.sendToUser(event.userId, 'Vitals Fit', text, 'meal.logged');

    this.logger.log(`[meal.logged] reason=${rec.reason} — ${text.slice(0, 80)}`);
  }
}
