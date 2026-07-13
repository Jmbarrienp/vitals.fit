import { useQuery } from '@tanstack/react-query';
import { weeklyReviewApi } from '../api/weeklyReview';
import type { ReviewSnapshot } from '../types';

/**
 * Weekly Review + Behavior Follow-Up, read straight from the backend engine.
 * Longer staleTime than the live snapshot — a completed week doesn't change.
 */
export function useWeeklyReview() {
  return useQuery({
    queryKey: ['weekly-review'],
    queryFn: () => weeklyReviewApi.get().then((r) => r.data as ReviewSnapshot),
    retry: 1,
    staleTime: 5 * 60_000,
  });
}
