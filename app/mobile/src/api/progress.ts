import { apiClient } from './client';
import { ProgressSummary, WeightLog } from '../types';

export const progressApi = {
  logWeight: (weightKg: number, notes?: string) =>
    apiClient.post<WeightLog>('/progress/weight', { weightKg, notes }),

  getSummary: () =>
    apiClient.get<ProgressSummary>('/progress/summary'),

  getHistory: () =>
    apiClient.get<WeightLog[]>('/progress'),
};
