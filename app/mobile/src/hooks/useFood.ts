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

// Lists whose rows carry the ⭐ flag; flipped optimistically so the tap feels instant.
const STAR_LISTS = ['food-search', 'food-common', 'food-recent', 'food-frequent'];

/** Optimistic favorite toggle: flips the star instantly, reconciles favorites on settle. */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      (next ? foodApi.addFavorite(id) : foodApi.removeFavorite(id)).then((r) => r.data),
    onMutate: async ({ id, next }) => {
      // Stop in-flight refetches from clobbering the optimistic state.
      await Promise.all(STAR_LISTS.map((k) => qc.cancelQueries({ queryKey: [k] })));
      const snapshot = STAR_LISTS.flatMap((k) => qc.getQueriesData<FoodItem[]>({ queryKey: [k] }));
      for (const k of STAR_LISTS) {
        qc.setQueriesData<FoodItem[]>({ queryKey: [k] }, (old) =>
          old?.map((f) => (f.id === id ? { ...f, isFavorite: next } : f)),
        );
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    // Only the Favoritos list changes membership; the star flags are already correct.
    onSettled: () => qc.invalidateQueries({ queryKey: ['food-favorites'] }),
  });
}

export function useCreateCustomFood() {
  const qc = useQueryClient();
  return useMutation<FoodItem, unknown, CreateCustomFoodInput>({
    mutationFn: (data) => foodApi.createCustom(data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['food-search'] }),
  });
}
