import { apiClient } from './client';
import type { MealPlan } from '../types';

export const mealPlanApi = {
  // Read-only adaptive daily meal plan (2D.1).
  get: () => apiClient.get<MealPlan>('/meal-plan'),
};
