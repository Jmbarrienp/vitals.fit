/**
 * Nutrition Vision contract (Phase 2D.2 V0). The stable boundary between the
 * vision domain and everything else (mobile, other backend domains, future
 * providers). No @prisma/client imports — every vocabulary is pinned here,
 * versioned, so a schema change can never silently change what a consumer sees.
 *
 * Design reference: docs/nutrition-vision-architecture.md (§4).
 */

export const VISION_CONTRACT_VERSION = 1;

export type ScanSource = 'PHOTO' | 'BARCODE' | 'MENU_OCR' | 'RECEIPT_OCR' | 'VIDEO_FRAME'; // growable

export type ScanStatus =
  | 'CREATED'
  | 'PROCESSING'
  | 'PROPOSED'
  | 'CONFIRMED'
  | 'LOGGED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'FALLBACK_MANUAL'; // user chose to log manually instead of confirming the proposal (V1)

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * The confirmation UX the backend recommends for a proposal (V1). The confidence
 * POLICY lives here, not in mobile: HIGH -> a confident confirm CTA; MEDIUM ->
 * review with explicit uncertainty; FALLBACK -> steer to manual logging (low
 * confidence, no detections, or a provider failure). Mobile only renders it.
 */
export type ScanUxMode = 'CONFIRM' | 'REVIEW' | 'FALLBACK';

export type PortionMethod =
  | 'REFERENCE_OBJECT'
  | 'PLATE_RATIO'
  | 'PROVIDER_ESTIMATE'
  | 'SERVING_DEFAULT'
  | 'USER';

/** One food region a provider detected in an image. Multi-food from day one. */
export interface Detection {
  label: string;
  labelConfidence: number; // 0..1 as reported by the provider
  boundingBox?: { x: number; y: number; w: number; h: number };
  portionHint?: { grams?: number; confidence?: number };
  attributes?: string[]; // 'packaged' | 'homemade' | 'liquid' | … growable
}

/** What a VisionProvider returns. Provider-agnostic: labels only, never nutrition math. */
export interface RecognitionResult {
  providerId: string;
  model: string;
  providerVersion: string;
  detections: Detection[]; // [] = nothing recognized — a valid, handled outcome
  latencyMs: number;
  raw?: unknown; // stored for audit/eval; never consumed by downstream logic
}

export interface PortionEstimate {
  grams: number;
  method: PortionMethod;
  confidence: number; // 0..1
}

export interface CandidateConfidence {
  recognition: number;
  match: number;
  portion: number;
  overall: number; // deterministic combination — see confidence.ts
  band: ConfidenceBand;
}

/** After catalog matching + portion estimation — what the user sees and confirms. */
export interface FoodCandidate {
  detectionIndex: number;
  foodItemId: string | null; // null -> will log as a one-off item (today's manual path allows this)
  displayName: string;
  matchScore: number; // 0..1 deterministic
  portion: PortionEstimate;
  confidence: CandidateConfidence;
  alternates: { foodItemId: string; displayName: string; matchScore: number }[];
}

/** The scan result exposed to mobile. No Prisma types, no vendor types. */
export interface VisionScanProposal {
  scanId: string;
  status: ScanStatus;
  source: ScanSource;
  mode: ScanUxMode; // backend-decided confirmation UX (confidence policy owned server-side)
  candidates: FoodCandidate[];
  scanConfidence: { overall: number; band: ConfidenceBand };
  suggestedMealType: string;
  fallback: { reason: string | null }; // set when degraded -> mobile opens manual flow prefilled
  contractVersion: number;
}

/** What confirmation sends back. Deliberately isomorphic to LogMealDto.items. */
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
  acceptedFromCandidate: number | null; // detectionIndex, or null if the user added it manually
}

export interface ScanConfirmation {
  scanId: string;
  mealType?: string;
  items: ScanConfirmationItem[];
}

export interface RecognitionHints {
  userId: string;
  suggestedMealType?: string;
}
