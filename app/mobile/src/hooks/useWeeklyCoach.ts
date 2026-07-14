import { useQuery } from '@tanstack/react-query';
import { coachApi } from '../api/coach';
import type { WeeklyCoachResult } from '../types';

/** Weekly AI coaching. Cached longer — it summarizes a completed week. */
export function useWeeklyCoach() {
  return useQuery({
    queryKey: ['weekly-coach'],
    queryFn: () => coachApi.getWeekly().then((r) => r.data as WeeklyCoachResult),
    retry: 1,
    staleTime: 5 * 60_000,
  });
}
