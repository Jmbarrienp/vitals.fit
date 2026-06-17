import { Injectable } from '@nestjs/common';
import { GoalType, PersonaType, Sex } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NutritionStateService } from '../../nutrition-state/nutrition-state.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionState: NutritionStateService,
  ) {}

  async buildSnapshot(userId: string): Promise<UserSnapshot> {
    const today = startOfDay(new Date());

    // Today's intake + goal targets stay real-time; the longitudinal fields
    // (adherence 7d, weight trend, streak) come from the cached state.
    const [profileData, goalData, todayLog, state] = await Promise.all([
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
      this.nutritionState.get(userId),
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
        // weeklyRate from the shared least-squares helper (was a 2-point diff).
        weightTrendKg: state.weightTrendKgWk,
        adherencePct7d: state.adherencePct7d ?? 0,
      },
      streak: {
        currentDays: state.loggingStreak,
      },
      state: {
        adherenceScore: state.adherenceScore,
        nutritionScore: state.nutritionScore,
        plateauStatus: state.plateauStatus,
        behaviorFlags: state.behaviorFlags,
        trendStatus: state.trendStatus,
      },
    };
  }
}

function startOfDay(date: Date): Date {
  date.setHours(0, 0, 0, 0);
  return date;
}
