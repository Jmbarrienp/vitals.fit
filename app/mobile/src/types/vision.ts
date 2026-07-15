/**
 * Nutrition Vision contract mirror (V1). These match the backend's
 * vision-contract.ts exactly. The mobile app RENDERS these values and sends
 * confirmation/rejection — it computes no nutrition and no confidence.
 */

export type ScanSource = 'PHOTO' | 'BARCODE' | 'MENU_OCR' | 'RECEIPT_OCR' | 'VIDEO_FRAME';
export type ScanStatus =
  | 'CREATED' | 'PROCESSING' | 'PROPOSED' | 'CONFIRMED' | 'LOGGED'
  | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'FALLBACK_MANUAL';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';
export type ScanUxMode = 'CONFIRM' | 'REVIEW' | 'FALLBACK';
export type PortionMethod = 'REFERENCE_OBJECT' | 'PLATE_RATIO' | 'PROVIDER_ESTIMATE' | 'SERVING_DEFAULT' | 'USER';
export type VisionFoodSource = 'favorite' | 'frequent' | 'recent' | 'custom' | 'catalog';

export interface PortionEstimate {
  grams: number;
  method: PortionMethod;
  confidence: number;
}

export interface CandidateConfidence {
  recognition: number;
  match: number;
  portion: number;
  overall: number;
  band: ConfidenceBand;
}

export interface FoodCandidate {
  detectionIndex: number;
  foodItemId: string | null;
  displayName: string;
  matchScore: number;
  portion: PortionEstimate;
  confidence: CandidateConfidence;
  alternates: { foodItemId: string; displayName: string; matchScore: number }[];
}

export interface VisionScanProposal {
  scanId: string;
  status: ScanStatus;
  source: ScanSource;
  mode: ScanUxMode;
  candidates: FoodCandidate[];
  scanConfidence: { overall: number; band: ConfidenceBand };
  suggestedMealType: string;
  fallback: { reason: string | null };
  contractVersion: number;
}

/** Isomorphic to LogMealDto.items — confirmation converges on the existing write path. */
export interface ScanConfirmationItem {
  foodItemId: string | null;
  customName?: string;
  quantity: number;
  unit: string;
  grams?: number;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  acceptedFromCandidate: number | null;
}
