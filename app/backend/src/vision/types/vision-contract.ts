/**
 * Nutrition Vision contract (Phase 2D.2 V0). The stable boundary between the
 * vision domain and everything else (mobile, other backend domains, future
 * providers). No @prisma/client imports — every vocabulary is pinned here,
 * versioned, so a schema change can never silently change what a consumer sees.
 *
 * Design reference: docs/nutrition-vision-architecture.md (§4).
 */

import { NutritionLabel } from './ocr-contract';
import { RestaurantContext } from './restaurant-contract';

export const VISION_CONTRACT_VERSION = 1;

/**
 * growable. `LABEL_OCR` (V3.2) is a nutrition-facts panel — distinct from
 * MENU_OCR (a restaurant menu) and RECEIPT_OCR (a purchase receipt), which read
 * different documents for different purposes. Adding a member costs nothing: the
 * column is a String, never a Postgres enum (lesson 2B.1), so no migration.
 */
export type ScanSource = 'PHOTO' | 'BARCODE' | 'LABEL_OCR' | 'MENU_OCR' | 'RECEIPT_OCR' | 'VIDEO_FRAME';

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
  | 'USER'
  | 'USER_PRIOR' // V3.3: the user's own history dominated the blend
  | 'BLENDED'; // V3.3: several signals combined, none dominant

/**
 * One input the Portion Estimation Engine (V3.3) blended into the final grams.
 * VISION is the provider's opinion (already bias-corrected); USER_HISTORY is
 * the median of the user's validated logs; PLANNER is what the active plan
 * expects; CATALOG_DEFAULT is the food's default serving. Weights and notes are
 * platform-computed — this is the deterministic, explainable audit trail of
 * every portion decision.
 */
export type PortionSignalSource = 'VISION' | 'USER_HISTORY' | 'PLANNER' | 'CATALOG_DEFAULT';

export interface PortionSignal {
  source: PortionSignalSource;
  grams: number;
  weight: number; // 0..1 relative weight in the blend
  note: string; // human-readable, deterministic explanation
}

/** One food region a provider detected in an image. Multi-food from day one. */
export interface Detection {
  label: string;
  labelConfidence: number; // 0..1 as reported by the provider
  boundingBox?: { x: number; y: number; w: number; h: number };
  portionHint?: { grams?: number; confidence?: number };
  attributes?: string[]; // 'packaged' | 'homemade' | 'liquid' | … growable
}

/**
 * Scene-level perception (V3.4) — where the meal appears to be, read from the
 * SAME photo in the SAME provider call as the detections. This is perception,
 * never nutrition: a setting, a confidence, and at most a name the provider can
 * literally see (signage, menu, branded plating). UNKNOWN with confidence 0 is
 * the honest default. The vocabulary is growable (String semantics, lesson 2B.1).
 */
export type SceneSetting = 'RESTAURANT' | 'HOME' | 'UNKNOWN';

export interface SceneContext {
  setting: SceneSetting;
  confidence: number; // 0..1 — how sure the provider is about the SETTING
  restaurantName: string | null; // only if literally visible in the image; never guessed
  category: string | null; // cuisine/menu category cue, e.g. 'tacos', 'italiana'
}

/** What a VisionProvider returns. Provider-agnostic: labels only, never nutrition math. */
export interface RecognitionResult {
  providerId: string;
  model: string;
  providerVersion: string;
  detections: Detection[]; // [] = nothing recognized — a valid, handled outcome
  /**
   * V3.4 — optional scene perception. Additive: pre-V3.4 providers never set it
   * and every consumer treats absence as UNKNOWN. Validated at the same gate as
   * detections; a malformed scene is STRIPPED (the cue is expendable, the scan
   * is not) rather than failing the scan.
   */
  scene?: SceneContext;
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
  /**
   * V3.3 — how the portion engine arrived at `portion.grams`. Additive and
   * optional: pre-V3.3 proposals persisted without it, and consumers that
   * ignore it lose nothing. Only deterministic platform output is ever stored
   * here — never a raw provider assumption.
   */
  portionExplanation?: PortionSignal[];
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
  /**
   * The transcribed nutrition facts — present ONLY for `source: 'LABEL_OCR'`
   * (V3.2). Optional and additive: every existing consumer ignores it, and no
   * other modality sets it.
   *
   * This is the one place the vision contract carries nutrition, and only because
   * OCR transcribes what a manufacturer printed rather than inferring it from
   * appearance. `RecognitionResult` still carries perception only — see the
   * epistemic split documented in `ocr-contract.ts`. Mobile renders these as
   * EDITABLE fields; the user confirms every number before anything is logged.
   */
  label?: NutritionLabel;
  /**
   * V3.4 — restaurant context, present ONLY when the scene signal cleared the
   * confidence threshold. A signal that improves drafting quality, never a new
   * source of truth: menu candidates carry published nutrition or null, the
   * user confirms everything, and confirmation converges on the same write
   * path. Absence = the fallback state (a normal photo scan).
   */
  restaurant?: RestaurantContext;
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
