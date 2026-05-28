import { useQuery } from '@tanstack/react-query';
import { foodApi } from '../api/food';

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
