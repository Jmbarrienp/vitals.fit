import { useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendationsApi } from '../api/recommendations';

/**
 * Phase 2B.1 — commitment lifecycle mutations. A recommendation becomes a pledge
 * (commit) and later done (complete). Both shift longitudinal state, so they
 * invalidate the recommendation list AND the intelligence snapshot.
 */
function useLifecycleMutation(fn: (id: string) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['intelligence'] });
    },
  });
}

export function useCommitRecommendation() {
  return useLifecycleMutation((id) => recommendationsApi.commit(id));
}

export function useCompleteRecommendation() {
  return useLifecycleMutation((id) => recommendationsApi.complete(id));
}
