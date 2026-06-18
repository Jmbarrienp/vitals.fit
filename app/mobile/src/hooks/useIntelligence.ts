import { useQuery } from '@tanstack/react-query';
import { intelligenceApi } from '../api/intelligence';
import type { IntelligenceSnapshot } from '../types';

/** Longitudinal nutrition intelligence, read straight from the backend rollup. */
export function useIntelligence() {
  return useQuery({
    queryKey: ['intelligence'],
    queryFn: () => intelligenceApi.get().then((r) => r.data as IntelligenceSnapshot),
    retry: 1,
    staleTime: 60_000,
  });
}
