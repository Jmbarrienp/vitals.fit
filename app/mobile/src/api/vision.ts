import { apiClient } from './client';
import type { ScanConfirmationItem, ScanSource, VisionScanProposal } from '../types/vision';

/** Nutrition Vision V1 endpoints. Vision proposes; LogsService (via confirm) commits truth. */
export const visionApi = {
  createScan: (imageRef: string, source: ScanSource = 'PHOTO') =>
    apiClient.post<VisionScanProposal>('/vision/scans', { imageRef, source }),

  getScan: (id: string) => apiClient.get<VisionScanProposal>(`/vision/scans/${id}`),

  confirm: (id: string, items: ScanConfirmationItem[], mealType?: string) =>
    apiClient.post(`/vision/scans/${id}/confirm`, { items, mealType }),

  reject: (id: string) => apiClient.post(`/vision/scans/${id}/reject`),

  // User chose manual logging instead — records the fallback (creates no meal).
  fallback: (id: string) => apiClient.post(`/vision/scans/${id}/fallback`),
};
