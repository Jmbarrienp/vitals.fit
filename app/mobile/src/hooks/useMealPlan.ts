import { useQuery } from '@tanstack/react-query';
import { mealPlanApi } from '../api/mealPlan';
import type { MealPlan } from '../types';

/** Adaptive daily meal plan — the planner's strategy as concrete meals. */
export function useMealPlan() {
  return useQuery({
    queryKey: ['meal-plan'],
    queryFn: () => mealPlanApi.get().then((r) => r.data as MealPlan),
    retry: 1,
    staleTime: 5 * 60_000,
  });
}
