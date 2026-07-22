import { apiClient } from './client';

/**
 * Copilot API client (V5.0) — read-only. The session is a versioned contract
 * the backend coordinated; this client fetches it and the screen renders it.
 * The client computes nothing and can change nothing: acting on a suggestion
 * goes through the module that owns it (logs, vision, recommendations).
 */
export const copilotApi = {
  /** V5.1 — the daily session: the whole user-facing experience, copy included. */
  daily: () => apiClient.get<any>('/copilot/daily'),
  session: () => apiClient.get<any>('/copilot/session'),
  nextAction: () => apiClient.get<any>('/copilot/next-action'),
};
