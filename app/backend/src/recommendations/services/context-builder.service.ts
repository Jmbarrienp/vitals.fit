import { Injectable } from '@nestjs/common';
import { GoalType, PersonaType, Sex } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RecentMeal, UserSnapshot } from '../types/user-snapshot';

const PERSONA_MAP: Record<PersonaType, UserSnapshot['persona']> = {
  PRINCIPIANTE_MOTIVADO: 'beginner',
  ATLETA_AMATEUR: 'athlete',
  OCUPADO_CONSISTENTE: 'busy',
  REINCIDENTE: 'returning',
  EXPERTO_AUTODIRIGIDO: 'expert',
};

const GOAL_MAP: Record<GoalType, UserSnapshot['goal']> = {
  LOSE_FAT: 'lose',
  GAIN_MUSCLE: 'gain',
  MAINTAIN: 'maintain',
  RECOMPOSITION: 'maintain',
  HEALTH_WELLNESS: 'maintain',
};

const SEX_MAP: Record<Sex, UserSnapshot['sex']> = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
};

@Injectable()
export class ContextBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async buildSnapshot(userId: string): Promise<UserSnapshot> {
    const today = startOfDay(new Date());
    const sevenDaysAgo = startOfDay(new Date());
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [profileData, goalData, todayLog, habitsData, last7Logs, recentWeights] =
      await Promise.all([
        this.prisma.userProfile.findUnique({
          where: { userId },
          select: { persona: true, sex: true },
        }),
        this.prisma.goal.findFirst({
          where: { userId, isActive: true },
          orderBy: { createdAt: 'desc' },
          select: {
            type: true,
            targetCalories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
            tdee: true,
          },
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
        this.prisma.userHabits.findUnique({
          where: { userId },
          select: { currentStreak: true },
        }),
        this.prisma.dailyLog.findMany({
          where: { userId, date: { gte: sevenDaysAgo } },
          select: { adherencePct: true, planFollowed: true },
          orderBy: { date: 'desc' },
        }),
        this.prisma.weightLog.findMany({
          where: { userId },
          orderBy: { date: 'desc' },
          take: 2,
          select: { weightKg: true },
        }),
      ]);

    const personaKey = profileData?.persona ?? PersonaType.PRINCIPIANTE_MOTIVADO;
    const goalKey = goalData?.type ?? GoalType.MAINTAIN;
    const sexKey = profileData?.sex ?? Sex.OTHER;

    const recentMeals: RecentMeal[] = (todayLog?.loggedMeals ?? []).map((m) => ({
      name: m.name ?? 'Comida',
      calories: m.totalCalories,
      mealType: m.mealType.toLowerCase(),
    }));

    return {
      userId,
      goal: GOAL_MAP[goalKey],
      persona: PERSONA_MAP[personaKey],
      sex: SEX_MAP[sexKey],
      targets: {
        tdee: Math.round(goalData?.tdee ?? 2000),
        calories: goalData?.targetCalories ?? 2000,
        proteinG: goalData?.proteinG ?? 150,
        carbsG: goalData?.carbsG ?? 200,
        fatG: goalData?.fatG ?? 65,
      },
      today: {
        caloriesLogged: todayLog?.caloriesLogged ?? 0,
        proteinG: todayLog?.proteinG ?? 0,
        carbsG: todayLog?.carbsG ?? 0,
        fatG: todayLog?.fatG ?? 0,
        mealsLogged: todayLog?.loggedMeals.length ?? 0,
        recentMeals,
      },
      progress: {
        weightTrendKg: computeWeightTrend(recentWeights),
        adherencePct7d: computeAdherence(last7Logs),
      },
      streak: {
        currentDays: habitsData?.currentStreak ?? 0,
      },
    };
  }
}

function startOfDay(date: Date): Date {
  date.setHours(0, 0, 0, 0);
  return date;
}

function computeAdherence(
  logs: Array<{ adherencePct: number | null; planFollowed: boolean | null }>,
): number {
  const evaluated = logs.filter((l) => l.planFollowed !== null);
  if (evaluated.length === 0) return 0;
  const sum = evaluated.reduce((acc, l) => {
    if (l.adherencePct !== null) return acc + l.adherencePct * 100;
    return acc + (l.planFollowed ? 100 : 0);
  }, 0);
  return Math.round(sum / evaluated.length);
}

function computeWeightTrend(weights: Array<{ weightKg: number }>): number | null {
  if (weights.length < 2) return null;
  return Math.round((weights[0].weightKg - weights[1].weightKg) * 10) / 10;
}
