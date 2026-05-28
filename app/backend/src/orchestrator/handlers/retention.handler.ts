import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { MealLoggedEvent } from '../events/meal.event';
import { OnboardingCompletedEvent } from '../events/onboarding.event';

@Injectable()
export class RetentionHandler {
  private readonly logger = new Logger(RetentionHandler.name);

  constructor(private prisma: PrismaService) {}

  @OnEvent('meal.logged')
  async handleMealLogged(event: MealLoggedEvent) {
    this.logger.log(`[retention-agent] meal.logged for ${event.userId} — ${event.totalCalories} kcal`);

    // Update streak and last active
    const habits = await this.prisma.userHabits.findUnique({
      where: { userId: event.userId },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let newStreak = 1;
    if (habits?.lastActiveAt) {
      const lastDate = new Date(habits.lastActiveAt);
      lastDate.setHours(0, 0, 0, 0);
      if (lastDate.getTime() === yesterday.getTime()) {
        newStreak = (habits.currentStreak ?? 0) + 1;
      }
    }

    await this.prisma.userHabits.upsert({
      where: { userId: event.userId },
      create: {
        userId: event.userId,
        lastActiveAt: new Date(),
        currentStreak: newStreak,
        longestStreak: newStreak,
        daysInactive: 0,
        typicalMealTimes: [],
        preferredFoods: [],
        dislikedFoods: [],
      },
      update: {
        lastActiveAt: new Date(),
        currentStreak: newStreak,
        longestStreak: Math.max(newStreak, habits?.longestStreak ?? 0),
        daysInactive: 0,
      },
    });

    // Check milestones
    await this.checkMilestones(event.userId, newStreak);

    this.logger.log(`[retention-agent] streak updated to ${newStreak}`);
  }

  @OnEvent('onboarding.completed')
  async handleOnboarding(event: OnboardingCompletedEvent) {
    this.logger.log(`[retention-agent] onboarding.completed for ${event.userId} — goal: ${event.goalType}`);

    await this.prisma.userHabits.upsert({
      where: { userId: event.userId },
      create: {
        userId: event.userId,
        lastActiveAt: new Date(),
        currentStreak: 1,
        longestStreak: 1,
        daysInactive: 0,
        typicalMealTimes: [],
        preferredFoods: [],
        dislikedFoods: [],
      },
      update: { lastActiveAt: new Date() },
    });

    this.logger.log(`[retention-agent] habits initialized`);
  }

  private async checkMilestones(userId: string, streak: number) {
    const milestoneMap = {
      7: 'STREAK_7_DAYS',
      30: 'STREAK_30_DAYS',
    };

    const milestoneType = milestoneMap[streak];
    if (!milestoneType) return;

    const existing = await this.prisma.userMilestone.findFirst({
      where: { userId, type: milestoneType as any },
    });

    if (!existing) {
      await this.prisma.userMilestone.create({
        data: { userId, type: milestoneType as any },
      });
      this.logger.log(`[retention-agent] 🎯 milestone unlocked: ${milestoneType}`);
    }
  }
}
