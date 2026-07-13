import { apiClient } from './client';
import type { ReviewSnapshot } from '../types';

export const weeklyReviewApi = {
  // Read-only Weekly Review + Behavior Follow-Up projection (2B.3).
  get: () => apiClient.get<ReviewSnapshot>('/nutrition-state/weekly-review'),
};
