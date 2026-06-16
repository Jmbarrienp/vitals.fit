import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { foodApi, CreateCustomFoodInput, FoodItem } from '../api/food';

export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: ['food-search', query],
    queryFn: () => foodApi.search(query).then((r) => r.data),
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });
}

export function useCommonFoods() {
  return useQuery({
    queryKey: ['food-common'],
    queryFn: () => foodApi.getCommon().then((r) => r.data),
    staleTime: 1000 * 60 * 30,
  });
}

export function useRecentFoods() {
  return useQuery({
    queryKey: ['food-recent'],
    queryFn: () => foodApi.getRecent().then((r) => r.data),
    staleTime: 1000 * 60 * 2,
  });
}

export function useFrequentFoods() {
  return useQuery({
    queryKey: ['food-frequent'],
    queryFn: () => foodApi.getFrequent().then((r) => r.data),
    staleTime: 1000 * 60 * 5,
  });
}

export function useFavoriteFoods() {
  return useQuery({
    queryKey: ['food-favorites'],
    queryFn: () => foodApi.getFavorites().then((r) => r.data),
    staleTime: 1000 * 60 * 5,
  });
}

/** Optimistic favorite toggle; invalidates every list that shows the star. */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      (next ? foodApi.addFavorite(id) : foodApi.removeFavorite(id)).then((r) => r.data),
    onSettled: () => {
      ['food-favorites', 'food-recent', 'food-frequent', 'food-common', 'food-search'].forEach(
        (k) => qc.invalidateQueries({ queryKey: [k] }),
      );
    },
  });
}

export function useCreateCustomFood() {
  const qc = useQueryClient();
  return useMutation<FoodItem, unknown, CreateCustomFoodInput>({
    mutationFn: (data) => foodApi.createCustom(data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['food-search'] }),
  });
}
