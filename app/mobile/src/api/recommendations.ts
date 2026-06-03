import { apiClient } from './client';
import type { Recommendation } from '../types';

export const recommendationsApi = {
  getHistory: () => apiClient.get<Recommendation[]>('/recommendations/history'),
};
