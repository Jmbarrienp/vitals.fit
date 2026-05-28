import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nutritionApi } from '../api/nutrition';
import { GoalType } from '../types';

export function useActiveGoal() {
  return useQuery({
    queryKey: ['goal'],
    queryFn: () => nutritionApi.getActiveGoal().then((r) => r.data),
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, targetWeightKg }: { type: GoalType; targetWeightKg?: number }) =>
      nutritionApi.createGoal(type, targetWeightKg).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goal'] }),
  });
}

export function useCalculateNutrition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => nutritionApi.calculate().then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goal'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useTodayLog() {
  return useQuery({
    queryKey: ['today'],
    queryFn: () => nutritionApi.getToday().then((r) => r.data),
    refetchInterval: 30000,
  });
}

export function useLogMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: nutritionApi.logMeal,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['today'] }),
  });
}
