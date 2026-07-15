import { MenuLookupResult } from '../types/restaurant-contract';

/**
 * The restaurant-menu knowledge port (V3.4) — the fourth provider seam, same
 * shape as VisionProvider / BarcodeLookupProvider / OCRProvider: one method,
 * platform types in and out, swappable by config, no vendor payloads past the
 * adapter.
 *
 * A menu provider may TRANSCRIBE published menu data (names, published
 * nutrition). It must never estimate, derive, or fill in nutrition it cannot
 * cite — a dish without published macros returns them as null, and the
 * platform keeps them null all the way to the user.
 */
export interface MenuLookupRequest {
  restaurantName: string | null; // as perceived from the image; may be null
  category: string | null;
  detectionLabels: string[]; // what the plate appears to contain — a ranking hint
}

export interface RestaurantMenuProvider {
  readonly id: string;
  lookup(req: MenuLookupRequest): Promise<MenuLookupResult>;
}
