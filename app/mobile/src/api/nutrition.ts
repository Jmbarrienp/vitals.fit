import { apiClient } from './client';
import { Goal, GoalType, NutritionResult, DailyLog, LoggedMeal, MealType } from '../types';

/** Un ítem a registrar: de catálogo (foodItemId) o manual (customName). */
export interface LogMealItemInput {
  foodItemId?: string;
  servingSizeId?: string;
  customName?: string;
  unit?: string;
  quantity: number;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

/** Payload de registro: nuevo flujo (items[]) o legacy (totales precalculados). */
export interface LogMealInput {
  mealType?: MealType;
  name?: string;
  items?: LogMealItemInput[];
  totalCalories?: number;
  totalProteinG?: number;
  totalCarbsG?: number;
  totalFatG?: number;
}

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

  logMeal: (data: LogMealInput) => apiClient.post('/logs/meal', data),

  updateMeal: (id: string, data: UpdateMealPayload) =>
    apiClient.patch<DailyLog>(`/logs/meal/${id}`, data),

  deleteMeal: (id: string) =>
    apiClient.delete<DailyLog>(`/logs/meal/${id}`),

  deleteMealItem: (mealId: string, itemId: string) =>
    apiClient.delete<DailyLog>(`/logs/meal/${mealId}/item/${itemId}`),

  getToday: () =>
    apiClient.get<DailyLog>('/logs/today'),
};
