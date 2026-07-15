import { LabelExtraction } from '../types/ocr-contract';

/**
 * The port every nutrition-label OCR backend implements (Phase 2D.2 V3.2).
 * Claude Vision, GPT Vision, Gemini Vision, an on-device OCR engine, or a
 * commercial OCR API are all interchangeable adapters behind this interface.
 * No vendor name appears outside `vision/ocr/`.
 *
 * Same imageRef indirection as `VisionProvider`: the port carries an OPAQUE
 * reference, never bytes. Adapters that need pixels resolve the ref through the
 * `VisionImageStore` (V2's transport seam), which is what lets a durable store
 * swap in later without touching this contract.
 *
 * `extract` transcribes; it does not interpret. Normalization and validation are
 * the platform's job — see `pipeline/label-parser.ts` and `label-validator.ts`.
 */
export interface OCRProvider {
  readonly id: string;
  extract(req: { imageRef: string; hints?: { userId?: string } }): Promise<LabelExtraction>;
}
