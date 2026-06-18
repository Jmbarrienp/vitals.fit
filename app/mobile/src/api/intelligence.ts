import { apiClient } from './client';
import type { IntelligenceSnapshot } from '../types';

export const intelligenceApi = {
  // Read-only compact snapshot of longitudinal nutrition intelligence.
  get: () => apiClient.get<IntelligenceSnapshot>('/nutrition-state/intelligence'),
};
