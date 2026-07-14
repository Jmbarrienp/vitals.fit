import { apiClient } from './client';
import type { WeeklyCoachResult } from '../types';

export const coachApi = {
  // Read-only weekly AI coaching (2C.1). Structured + compact.
  getWeekly: () => apiClient.get<WeeklyCoachResult>('/coach/weekly'),
};
