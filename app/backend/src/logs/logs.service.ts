import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogMealDto } from './dto/log-meal.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MealLoggedEvent } from '../orchestrator/events/meal.event';

@Injectable()
export class LogsService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async logMeal(userId: string, dto: LogMealDto) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get or create today's daily log
    let dailyLog = await this.prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!dailyLog) {
      dailyLog = await this.prisma.dailyLog.create({
        data: { userId, date: today },
      });
    }

    // Add the meal
    const meal = await this.prisma.loggedMeal.create({
      data: {
        dailyLogId: dailyLog.id,
        mealType: dto.mealType,
        name: dto.name ?? dto.mealType,
        totalCalories: dto.totalCalories,
        totalProteinG: dto.totalProteinG,
        totalCarbsG: dto.totalCarbsG,
        totalFatG: dto.totalFatG,
      },
    });

    // Recalculate daily totals
    const meals = await this.prisma.loggedMeal.findMany({
      where: { dailyLogId: dailyLog.id },
    });

    const totals = meals.reduce(
      (acc, m) => ({
        calories: acc.calories + m.totalCalories,
        protein: acc.protein + Number(m.totalProteinG),
        carbs: acc.carbs + Number(m.totalCarbsG),
        fat: acc.fat + Number(m.totalFatG),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const updated = await this.prisma.dailyLog.update({
      where: { id: dailyLog.id },
      data: {
        caloriesLogged: totals.calories,
        proteinG: totals.protein,
        carbsG: totals.carbs,
        fatG: totals.fat,
      },
      include: { loggedMeals: true },
    });

    // Emit event → triggers recommendation listener (AI + push) and retention handler
    this.eventEmitter.emit('meal.logged', new MealLoggedEvent(userId, meal.id, new Date(), totals.calories));

    return updated;
  }

  async getToday(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyLog = await this.prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { loggedMeals: true },
    });

    if (!dailyLog) {
      return { message: 'No hay registros para hoy', date: today, meals: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    }

    // Compare to goal targets
    const goal = await this.prisma.goal.findFirst({
      where: { userId, isActive: true },
    });

    const remaining = goal ? {
      calories: goal.targetCalories - dailyLog.caloriesLogged,
      proteinG: goal.proteinG - Number(dailyLog.proteinG),
      carbsG: goal.carbsG - Number(dailyLog.carbsG),
      fatG: goal.fatG - Number(dailyLog.fatG),
    } : null;

    return {
      date: today,
      totals: {
        calories: dailyLog.caloriesLogged,
        proteinG: dailyLog.proteinG,
        carbsG: dailyLog.carbsG,
        fatG: dailyLog.fatG,
      },
      target: goal ? {
        calories: goal.targetCalories,
        proteinG: goal.proteinG,
        carbsG: goal.carbsG,
        fatG: goal.fatG,
      } : null,
      remaining,
      meals: dailyLog.loggedMeals,
    };
  }

  async getRecent(userId: string) {
    const logs = await this.prisma.dailyLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 7,
      include: { loggedMeals: true },
    });
    return logs;
  }
}
