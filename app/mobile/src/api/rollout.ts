import { apiClient } from './client';

/**
 * Rollout API client (V4.0) — admin-only, read-only. Types are intentionally
 * loose (`any`-shaped payloads rendered as-is): this dashboard RENDERS what the
 * backend derived and computes nothing itself. The backend contracts are the
 * truth; duplicating them here in full would be a second vocabulary to drift.
 */
export const rolloutApi = {
  status: (days?: number) => apiClient.get<any>('/vision/rollout', { params: { days } }),
  trust: (days?: number) => apiClient.get<any>('/vision/trust', { params: { days } }),
  health: (days?: number) => apiClient.get<any>('/vision/health', { params: { days } }),
  risk: (days?: number) => apiClient.get<any>('/vision/risk', { params: { days } }),
  timeline: (days?: number) => apiClient.get<any>('/vision/timeline', { params: { days } }),
};
