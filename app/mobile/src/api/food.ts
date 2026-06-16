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
  isFavorite?: boolean;
}

export interface CreateCustomFoodInput {
  name: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g?: number;
}

export const foodApi = {
  search: (q: string, limit = 15) =>
    apiClient.get<FoodItem[]>('/food/search', { params: { q, limit } }),

  getCommon: () =>
    apiClient.get<FoodItem[]>('/food/common'),

  getRecent: () =>
    apiClient.get<FoodItem[]>('/food/recent'),

  getFrequent: () =>
    apiClient.get<FoodItem[]>('/food/frequent'),

  getFavorites: () =>
    apiClient.get<FoodItem[]>('/food/favorites'),

  addFavorite: (id: string) =>
    apiClient.post<{ ok: boolean }>(`/food/${id}/favorite`),

  removeFavorite: (id: string) =>
    apiClient.delete<{ ok: boolean }>(`/food/${id}/favorite`),

  createCustom: (data: CreateCustomFoodInput) =>
    apiClient.post<FoodItem>('/food/custom', data),

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
