import { apiClient } from './client';
import type { ScanConfirmationItem, ScanSource, VisionScanProposal } from '../types/vision';

/** What the camera captured. The photo goes to OUR backend, which owns the provider key — mobile never talks to a vendor. */
export interface CapturedImage {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

/** Nutrition Vision endpoints. Vision proposes; LogsService (via confirm) commits truth. */
export const visionApi = {
  /**
   * V2: sends the captured pixels for real recognition. `imageRef` remains a
   * plain capture label for provenance — the backend issues the real ref. Omit
   * `image` and the backend runs the reference-only (fixture) path.
   */
  createScan: (imageRef: string, source: ScanSource = 'PHOTO', image?: CapturedImage) =>
    apiClient.post<VisionScanProposal>('/vision/scans', {
      imageRef,
      source,
      ...(image ? { imageBase64: image.base64, imageMimeType: image.mimeType } : {}),
    }),

  /** V3.1: decoding already happened on-device — this sends the digits, never an image. Separate endpoint, same downstream proposal/confirm/reject/fallback contract. */
  createBarcodeScan: (barcode: string) =>
    apiClient.post<VisionScanProposal>('/vision/scans/barcode', { barcode }),

  getScan: (id: string) => apiClient.get<VisionScanProposal>(`/vision/scans/${id}`),

  confirm: (id: string, items: ScanConfirmationItem[], mealType?: string) =>
    apiClient.post(`/vision/scans/${id}/confirm`, { items, mealType }),

  reject: (id: string) => apiClient.post(`/vision/scans/${id}/reject`),

  // User chose manual logging instead — records the fallback (creates no meal).
  fallback: (id: string) => apiClient.post(`/vision/scans/${id}/fallback`),
};
