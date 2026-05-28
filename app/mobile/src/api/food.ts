import { apiClient } from './client';

export interface FoodItem {
  id: string;
  name: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  source: string;
  isCommon: boolean;
}

export const foodApi = {
  search: (q: string, limit = 15) =>
    apiClient.get<FoodItem[]>('/food/search', { params: { q, limit } }),

  getCommon: () =>
    apiClient.get<FoodItem[]>('/food/common'),

  findById: (id: string) =>
    apiClient.get<FoodItem>(`/food/${id}`),
};

export function macrosFromPortion(food: FoodItem, portionG: number) {
  const ratio = portionG / 100;
  return {
    calories: Math.round(food.caloriesPer100g * ratio),
    proteinG: Math.round(food.proteinPer100g * ratio * 10) / 10,
    carbsG: Math.round(food.carbsPer100g * ratio * 10) / 10,
    fatG: Math.round(food.fatPer100g * ratio * 10) / 10,
  };
}
