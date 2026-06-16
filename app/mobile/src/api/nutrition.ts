import { apiClient } from './client';
import { Goal, GoalType, NutritionResult, DailyLog, LoggedMeal, MealType } from '../types';

/** Payload de edición. Enviar totales reemplaza los ítems de la comida (compat backend). */
export interface UpdateMealPayload {
  mealType?: MealType;
  name?: string;
  totalCalories?: number;
  totalProteinG?: number;
  totalCarbsG?: number;
  totalFatG?: number;
}

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

  updateMeal: (id: string, data: UpdateMealPayload) =>
    apiClient.patch<DailyLog>(`/logs/meal/${id}`, data),

  deleteMeal: (id: string) =>
    apiClient.delete<DailyLog>(`/logs/meal/${id}`),

  deleteMealItem: (mealId: string, itemId: string) =>
    apiClient.delete<DailyLog>(`/logs/meal/${mealId}/item/${itemId}`),

  getToday: () =>
    apiClient.get<DailyLog>('/logs/today'),
};
