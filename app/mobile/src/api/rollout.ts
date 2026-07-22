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

  /** V4.1 — provider governance (paired comparison, drift, recommendation). Read-only. */
  governanceShadow: (days?: number) => apiClient.get<any>('/vision/governance/shadow', { params: { days } }),
  governanceComparison: (days?: number) => apiClient.get<any>('/vision/governance/comparison', { params: { days } }),
  governanceDrift: (days?: number) => apiClient.get<any>('/vision/governance/drift', { params: { days } }),
  governanceRecommendation: (days?: number) => apiClient.get<any>('/vision/governance/recommendation', { params: { days } }),

  /** V4.2 — promotion execution plan (pure consumer; read-only). */
  promotionPlan: (days?: number) => apiClient.get<any>('/vision/promotion-plan', { params: { days } }),

  /** V4.3 — safe rollback execution plan (pure consumer; read-only). */
  rollbackPlan: (days?: number) => apiClient.get<any>('/vision/rollback', { params: { days } }),
};
