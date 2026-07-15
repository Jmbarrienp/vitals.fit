import { BarcodeLookupResult } from '../types/barcode-contract';

/**
 * The port every barcode lookup backend implements (Phase 2D.2 V3.1). Mirrors
 * `VisionProvider` in spirit — swappable, registered, config-selected — but its
 * job is data retrieval (barcode digits -> product facts), not perception.
 * OpenFoodFacts, USDA, a commercial API, or an offline cache are all
 * interchangeable adapters behind this interface; no vendor name appears
 * outside `vision/barcode/`.
 */
export interface BarcodeLookupProvider {
  readonly id: string;
  lookup(barcode: string): Promise<BarcodeLookupResult>;
}
