import { RecognitionHints, RecognitionResult, ScanSource } from '../types/vision-contract';

export interface VisionProviderCapabilities {
  multiFood: boolean;
  portionHints: boolean;
  barcode: boolean;
  ocr: boolean;
  video: boolean;
}

/**
 * The port every recognition backend implements (Phase 2D.2 V0). Claude, GPT-4V,
 * Gemini, a self-hosted model, or the deterministic fixture below are all
 * interchangeable adapters behind this interface. No vendor name appears outside
 * `vision/providers/`; the pipeline only ever depends on this port.
 */
export interface VisionProvider {
  readonly id: string;
  readonly capabilities: VisionProviderCapabilities;
  recognize(req: { imageRef: string; source: ScanSource; hints?: RecognitionHints }): Promise<RecognitionResult>;
}
