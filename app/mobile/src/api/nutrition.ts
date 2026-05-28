import { apiClient } from './client';
import { Goal, GoalType, NutritionResult, DailyLog, LoggedMeal, MealType } from '../types';

export const nutritionApi = {
  createGoal: (type: GoalType, targetWeightKg?: number) =>
    apiClient.post<Goal>('/goals', { type, targetWeightKg }),

  getActiveGoal: () =>
    apiClient.get<Goal>('/goals/active'),

  calculate: () =>
    apiClient.post<NutritionResult>('/nutrition/calculate'),

  logMeal: (data: {
    mealType: MealType;
    name?: string;
    totalCalories: number;
    totalProteinG: number;
    totalCarbsG: number;
    totalFatG: number;
  }) => apiClient.post('/logs/meal', data),

  getToday: () =>
    apiClient.get<DailyLog>('/logs/today'),
};
