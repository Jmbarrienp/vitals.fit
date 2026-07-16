/**
 * Nutrition Vision contract mirror (V1). These match the backend's
 * vision-contract.ts exactly. The mobile app RENDERS these values and sends
 * confirmation/rejection — it computes no nutrition and no confidence.
 */

export type ScanSource = 'PHOTO' | 'BARCODE' | 'LABEL_OCR' | 'MENU_OCR' | 'RECEIPT_OCR' | 'VIDEO_FRAME';
export type ScanStatus =
  | 'CREATED' | 'PROCESSING' | 'PROPOSED' | 'CONFIRMED' | 'LOGGED'
  | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'FALLBACK_MANUAL'
  | 'UNDONE'; // V3.6 — an auto-accepted meal the user reverted
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';
/** V3.6 adds AUTO_ACCEPT: the platform already logged it; render undo, not confirm. */
export type ScanUxMode = 'CONFIRM' | 'REVIEW' | 'FALLBACK' | 'AUTO_ACCEPT';
export type PortionMethod =
  | 'REFERENCE_OBJECT'
  | 'PLATE_RATIO'
  | 'PROVIDER_ESTIMATE'
  | 'SERVING_DEFAULT'
  | 'USER'
  | 'USER_PRIOR' // V3.3: the user's own history dominated the blend
  | 'BLENDED'; // V3.3: several signals combined, none dominant

/** One input the portion engine (V3.3) blended into the final grams — mirrors vision-contract.ts. */
export type PortionSignalSource = 'VISION' | 'USER_HISTORY' | 'PLANNER' | 'CATALOG_DEFAULT';

export interface PortionSignal {
  source: PortionSignalSource;
  grams: number;
  weight: number;
  note: string;
}
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
  /** V3.3 — how the backend arrived at portion.grams. Optional/additive. */
  portionExplanation?: PortionSignal[];
}

/** Fields the backend reports as unreadable (V3.2). Pinned vocabulary — mirrors ocr-contract.ts. */
export type NutritionLabelField =
  | 'productName' | 'servingSize' | 'servingsPerContainer'
  | 'calories' | 'protein' | 'carbs' | 'fat';

export type ServingUnit = 'g' | 'ml' | 'unit';

/**
 * Transcribed nutrition facts from a label photo (V3.2). Every value is PER
 * SERVING and already normalized by the backend — the client renders and edits,
 * it never parses or converts.
 */
export interface NutritionLabel {
  productName: string | null;
  servingSize: number;
  servingUnit: ServingUnit;
  servingsPerContainer: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  missingFields: NutritionLabelField[];
  source: string;
  version: number;
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
  /** Present only for LABEL_OCR scans (V3.2). */
  label?: NutritionLabel;
  /** Present only when a PHOTO scan confidently detected a restaurant (V3.4). */
  restaurant?: RestaurantContext;
  /**
   * V3.6 — the backend's runtime trust decision. When `trust.executed` is true
   * the meal is ALREADY logged (status LOGGED, mode AUTO_ACCEPT) and the client
   * renders an undo affordance instead of a confirm CTA. The client never
   * computes trust; it renders what the platform decided.
   */
  trust?: AutoAcceptDecision;
}

/** V3.6 — the backend's auto-accept decision. Mirrors trust-contract.ts; the client only renders it. */
export type TrustLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type AutoAcceptAction = 'MANUAL_REVIEW' | 'REVIEW_REQUIRED' | 'AUTO_ACCEPT';

export interface AutoAcceptDecision {
  policyVersion: number;
  action: AutoAcceptAction;
  undoWindowSeconds: number;
  reason: string;
  signals: string[];
  trust: {
    policyVersion: number;
    level: TrustLevel;
    score: number;
    signals: string[];
    reasons: string[];
    evidence: {
      confirmations: number;
      corrections: number;
      undos: number;
      daysSinceLastConfirmation: number | null;
      userTotalConfirmations: number;
    };
    calibratedConfidence: number | null;
  };
  /** true = the platform already logged this meal; render undo, not confirm. */
  executed: boolean;
}

/** One dish a menu source knows (V3.4). Macros are PUBLISHED-or-null, never derived. */
export interface MenuCandidate {
  name: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  servingGrams: number | null;
}

/**
 * Restaurant context (V3.4) — present only when the backend's scene signal
 * cleared its confidence threshold. A drafting aid, never a source of truth;
 * absence means the scan behaves exactly like a home-cooked photo.
 */
export interface RestaurantContext {
  restaurantName: string | null;
  category: string | null;
  confidence: number;
  menuCandidates: MenuCandidate[];
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
