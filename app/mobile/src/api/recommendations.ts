import { apiClient } from './client';
import type { Recommendation } from '../types';

export const recommendationsApi = {
  getHistory: () => apiClient.get<Recommendation[]>('/recommendations/history'),
  // Phase 2B.1 — commitment lifecycle: a recommendation becomes a pledge, then done.
  commit: (id: string) => apiClient.post<Recommendation>(`/recommendations/${id}/commit`),
  complete: (id: string) => apiClient.post<Recommendation>(`/recommendations/${id}/complete`),
};
